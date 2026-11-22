package company

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores companies in companies (migration 0057).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository is the company repository over pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// defaultLock is the advisory lock MakeDefault holds while it moves the
// default, so two at once never meet in companies_default_idx.
const defaultLock = `SELECT pg_advisory_xact_lock(hashtext('companies.default'))`

// columns are a company's (c), with its live employees employed now counted
// (migration 0058's employments).
const columns = `c.id, c.code, c.name, c.company_code, c.vat_code, c.address, c.city, c.postal_code, c.country, c.notes,
	c.is_default,
	(SELECT count(*) FROM employments m JOIN employees e ON e.id = m.employee_id
		WHERE m.company_id = c.id AND m.ended_on IS NULL AND m.deleted_at IS NULL AND e.deleted_at IS NULL),
	c.created_at, c.updated_at, c.deleted_at, c.created_by_user_id, c.updated_by_user_id, c.deleted_by_user_id`

// scan reads a company row of columns, times in UTC; no row is ErrNotFound.
func scan(row pgx.Row) (Company, error) {
	var c Company
	err := row.Scan(&c.ID, &c.Code, &c.Name, &c.CompanyCode, &c.VATCode, &c.Address, &c.City, &c.PostalCode, &c.Country, &c.Notes,
		&c.IsDefault, &c.EmployeeCount,
		&c.CreatedAt, &c.UpdatedAt, &c.DeletedAt, &c.CreatedByUserID, &c.UpdatedByUserID, &c.DeletedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Company{}, ErrNotFound
	}
	if err != nil {
		return Company{}, err
	}
	c.CreatedAt, c.UpdatedAt = c.CreatedAt.UTC(), c.UpdatedAt.UTC()
	if c.DeletedAt != nil {
		at := c.DeletedAt.UTC()
		c.DeletedAt = &at
	}
	return c, nil
}

// Create inserts c and ev and reads c back.
func (r *PostgresRepository) Create(ctx context.Context, c Company, ev audit.Event) (Company, error) {
	var out Company
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO companies (id, code, name, company_code, vat_code, address, city, postal_code, country, notes,
				is_default, created_at, updated_at, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			c.ID, c.Code, c.Name, c.CompanyCode, c.VATCode, c.Address, c.City, c.PostalCode, c.Country, c.Notes,
			c.IsDefault, c.CreatedAt, c.UpdatedAt, c.CreatedByUserID, c.UpdatedByUserID); err != nil {
			return err
		}
		if err := audit.Insert(ctx, tx, ev); err != nil {
			return err
		}
		var err error
		out, err = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM companies c WHERE c.id = $1`, c.ID))
		return err
	})
	return out, translate(err)
}

// Get reads the live company, or ErrNotFound.
func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Company, error) {
	return scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM companies c WHERE c.id = $1 AND c.deleted_at IS NULL`, id))
}

// Default reads the live default company, or ErrNotFound.
func (r *PostgresRepository) Default(ctx context.Context) (Company, error) {
	return scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM companies c WHERE c.is_default AND c.deleted_at IS NULL`))
}

// List reads every live company, the default first, then by name and code.
func (r *PostgresRepository) List(ctx context.Context) ([]Company, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+columns+` FROM companies c WHERE c.deleted_at IS NULL
		ORDER BY c.is_default DESC, lower(c.name), lower(c.code), c.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Company, 0)
	for rows.Next() {
		c, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// lock locks the live company's row (ErrNotFound) and then reads it in a
// statement of its own, so its count of employees sees every employment
// committed before the lock was granted (an employment's insert holds the
// company's row FOR SHARE).
func lock(ctx context.Context, tx pgx.Tx, id uuid.UUID) (Company, error) {
	var got uuid.UUID
	err := tx.QueryRow(ctx, `SELECT id FROM companies WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id).Scan(&got)
	if errors.Is(err, pgx.ErrNoRows) {
		return Company{}, ErrNotFound
	}
	if err != nil {
		return Company{}, err
	}
	return scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM companies c WHERE c.id = $1`, id))
}

// write stores every field a mutation may change but is_default.
func write(ctx context.Context, tx pgx.Tx, next Company) error {
	_, err := tx.Exec(ctx, `
		UPDATE companies SET code = $2, name = $3, company_code = $4, vat_code = $5, address = $6, city = $7,
			postal_code = $8, country = $9, notes = $10, updated_at = $11, updated_by_user_id = $12,
			deleted_at = $13, deleted_by_user_id = $14
		WHERE id = $1`,
		next.ID, next.Code, next.Name, next.CompanyCode, next.VATCode, next.Address, next.City,
		next.PostalCode, next.Country, next.Notes, next.UpdatedAt, next.UpdatedByUserID, next.DeletedAt, next.DeletedByUserID)
	return err
}

// Update locks the live company, applies m and, when it returns events,
// writes every field m may change and them; then reads the company back,
// deleted or not.
func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Company, error) {
	var out Company
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := lock(ctx, tx, id)
		if err != nil {
			return err
		}
		next, evs, err := m(cur)
		if err != nil {
			return err
		}
		if len(evs) == 0 {
			out = cur
			return nil
		}
		next.ID = id
		if err := write(ctx, tx, next); err != nil {
			return err
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out, err = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM companies c WHERE c.id = $1`, id))
		return err
	})
	return out, translate(err)
}

// MakeDefault takes the default's lock, locks the company and the current
// default, applies m and, when it returns events, clears the old default and
// sets this one, then writes the events.
func (r *PostgresRepository) MakeDefault(ctx context.Context, id uuid.UUID, m func(cur Company, old *Company) (Company, []audit.Event, error)) (Company, error) {
	var out Company
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, defaultLock); err != nil {
			return err
		}
		cur, err := lock(ctx, tx, id)
		if err != nil {
			return err
		}
		var old *Company
		var oldID uuid.UUID
		switch err := tx.QueryRow(ctx, `SELECT id FROM companies WHERE is_default AND deleted_at IS NULL AND id <> $1 FOR UPDATE`, id).Scan(&oldID); {
		case errors.Is(err, pgx.ErrNoRows):
		case err != nil:
			return err
		default:
			o, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM companies c WHERE c.id = $1`, oldID))
			if err != nil {
				return err
			}
			old = &o
		}
		next, evs, err := m(cur, old)
		if err != nil {
			return err
		}
		if len(evs) == 0 {
			out = cur
			return nil
		}
		if old != nil {
			if _, err := tx.Exec(ctx, `UPDATE companies SET is_default = false, updated_at = $2, updated_by_user_id = $3 WHERE id = $1`,
				old.ID, next.UpdatedAt, next.UpdatedByUserID); err != nil {
				return err
			}
		}
		next.ID = id
		if err := write(ctx, tx, next); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE companies SET is_default = $2 WHERE id = $1`, id, next.IsDefault); err != nil {
			return err
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out, err = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM companies c WHERE c.id = $1`, id))
		return err
	})
	return out, translate(err)
}

// translate maps Postgres errors to sentinels: a unique violation is the code
// (ErrCodeTaken) or the default (ErrDefaultTaken), a foreign key the actor
// (ErrActorNotFound), a CHECK ErrInvalid naming the constraint.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505":
		if pgErr.ConstraintName == "companies_default_idx" {
			return ErrDefaultTaken
		}
		return ErrCodeTaken
	case "23503":
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
