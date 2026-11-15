package supplier

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

// PostgresRepository stores suppliers in suppliers (migration 0054).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository is the supplier repository over pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// columns are a supplier's (s), with its live catalogue items counted.
const columns = `s.id, s.code, s.name, s.company_code, s.vat_code, s.address, s.city, s.postal_code, s.country,
	s.contact_person, s.email, s.phone, s.website, s.bank_account, s.notes,
	(SELECT count(*) FROM catalogue_items i WHERE i.supplier_id = s.id AND i.deleted_at IS NULL),
	s.created_at, s.updated_at, s.deleted_at, s.created_by_user_id, s.updated_by_user_id, s.deleted_by_user_id`

// scan reads a supplier row of columns, times in UTC; no row is ErrNotFound.
func scan(row pgx.Row) (Supplier, error) {
	var s Supplier
	err := row.Scan(&s.ID, &s.Code, &s.Name, &s.CompanyCode, &s.VATCode, &s.Address, &s.City, &s.PostalCode, &s.Country,
		&s.ContactPerson, &s.Email, &s.Phone, &s.Website, &s.BankAccount, &s.Notes, &s.ItemCount,
		&s.CreatedAt, &s.UpdatedAt, &s.DeletedAt, &s.CreatedByUserID, &s.UpdatedByUserID, &s.DeletedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Supplier{}, ErrNotFound
	}
	if err != nil {
		return Supplier{}, err
	}
	s.CreatedAt, s.UpdatedAt = s.CreatedAt.UTC(), s.UpdatedAt.UTC()
	if s.DeletedAt != nil {
		at := s.DeletedAt.UTC()
		s.DeletedAt = &at
	}
	return s, nil
}

// Create inserts s and ev and reads s back.
func (r *PostgresRepository) Create(ctx context.Context, s Supplier, ev audit.Event) (Supplier, error) {
	var out Supplier
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO suppliers (id, code, name, company_code, vat_code, address, city, postal_code, country,
				contact_person, email, phone, website, bank_account, notes,
				created_at, updated_at, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
			s.ID, s.Code, s.Name, s.CompanyCode, s.VATCode, s.Address, s.City, s.PostalCode, s.Country,
			s.ContactPerson, s.Email, s.Phone, s.Website, s.BankAccount, s.Notes,
			s.CreatedAt, s.UpdatedAt, s.CreatedByUserID, s.UpdatedByUserID); err != nil {
			return err
		}
		if err := audit.Insert(ctx, tx, ev); err != nil {
			return err
		}
		var err error
		out, err = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM suppliers s WHERE s.id = $1`, s.ID))
		return err
	})
	return out, translate(err)
}

// Get reads the live supplier, or ErrNotFound.
func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Supplier, error) {
	return scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM suppliers s WHERE s.id = $1 AND s.deleted_at IS NULL`, id))
}

// List reads every live supplier by name, then code.
func (r *PostgresRepository) List(ctx context.Context) ([]Supplier, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+columns+` FROM suppliers s WHERE s.deleted_at IS NULL
		ORDER BY lower(s.name), lower(s.code), s.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Supplier, 0)
	for rows.Next() {
		s, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Update locks the live supplier, applies m and, when it returns events,
// writes every field m may change and them; then reads the supplier back,
// deleted or not.
func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Supplier, error) {
	var out Supplier
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM suppliers s WHERE s.id = $1 AND s.deleted_at IS NULL FOR UPDATE`, id))
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
		if _, err := tx.Exec(ctx, `
			UPDATE suppliers SET code = $2, name = $3, company_code = $4, vat_code = $5, address = $6, city = $7,
				postal_code = $8, country = $9, contact_person = $10, email = $11, phone = $12, website = $13,
				bank_account = $14, notes = $15, updated_at = $16, updated_by_user_id = $17,
				deleted_at = $18, deleted_by_user_id = $19
			WHERE id = $1`,
			id, next.Code, next.Name, next.CompanyCode, next.VATCode, next.Address, next.City,
			next.PostalCode, next.Country, next.ContactPerson, next.Email, next.Phone, next.Website,
			next.BankAccount, next.Notes, next.UpdatedAt, next.UpdatedByUserID, next.DeletedAt, next.DeletedByUserID); err != nil {
			return err
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out, err = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM suppliers s WHERE s.id = $1`, id))
		return err
	})
	return out, translate(err)
}

// translate maps Postgres errors to sentinels: a unique violation is the code
// (ErrCodeTaken), a foreign key the actor (ErrActorNotFound), a CHECK
// ErrInvalid naming the constraint.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505":
		return ErrCodeTaken
	case "23503":
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
