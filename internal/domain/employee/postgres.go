package employee

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores employees in the employees table (migration 0003).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const columns = `id, first_name, last_name, code, height_cm, clothing_size, shoe_size, notes,
	created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, deleted_by_user_id`

func scan(row pgx.Row) (Employee, error) {
	var e Employee
	err := row.Scan(&e.ID, &e.FirstName, &e.LastName, &e.Code, &e.HeightCm, &e.ClothingSize, &e.ShoeSize, &e.Notes,
		&e.CreatedAt, &e.UpdatedAt, &e.DeletedAt, &e.CreatedByUserID, &e.UpdatedByUserID, &e.DeletedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Employee{}, ErrNotFound
	}
	if err != nil {
		return Employee{}, err
	}
	e.CreatedAt, e.UpdatedAt = e.CreatedAt.UTC(), e.UpdatedAt.UTC()
	return e, nil
}

func scanAll(rows pgx.Rows) ([]Employee, error) {
	defer rows.Close()
	out := make([]Employee, 0)
	for rows.Next() {
		e, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (r *PostgresRepository) Create(ctx context.Context, e Employee, ev *audit.Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO employees (id, first_name, last_name, code, height_cm, clothing_size, shoe_size, notes,
				created_at, updated_at, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			e.ID, e.FirstName, e.LastName, e.Code, e.HeightCm, e.ClothingSize, e.ShoeSize, e.Notes,
			e.CreatedAt, e.UpdatedAt, e.CreatedByUserID, e.UpdatedByUserID); err != nil {
			return err
		}
		return insertEvent(ctx, tx, ev)
	}))
}

func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Employee, error) {
	return scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM employees WHERE id = $1 AND deleted_at IS NULL`, id))
}

func (r *PostgresRepository) List(ctx context.Context) ([]Employee, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+columns+` FROM employees WHERE deleted_at IS NULL
		ORDER BY lower(last_name), lower(first_name), id`)
	if err != nil {
		return nil, err
	}
	return scanAll(rows)
}

func (r *PostgresRepository) SearchByName(ctx context.Context, q string, limit int) ([]Employee, error) {
	pattern := "%" + escapeLike(strings.ToLower(q)) + "%"
	rows, err := r.pool.Query(ctx, `SELECT `+columns+` FROM employees
		WHERE deleted_at IS NULL AND (
			lower(first_name) LIKE $1 OR lower(last_name) LIKE $1
			OR lower(first_name || ' ' || last_name) LIKE $1 OR lower(coalesce(code, '')) LIKE $1)
		ORDER BY lower(last_name), lower(first_name), id
		LIMIT $2`, pattern, limit)
	if err != nil {
		return nil, err
	}
	return scanAll(rows)
}

func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Employee, error) {
	var out Employee
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx,
			`SELECT `+columns+` FROM employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id))
		if err != nil {
			return err
		}
		next, ev, err := m(cur)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE employees SET first_name = $2, last_name = $3, code = $4, height_cm = $5,
				clothing_size = $6, shoe_size = $7, notes = $8, updated_at = $9, updated_by_user_id = $10,
				deleted_at = $11, deleted_by_user_id = $12
			WHERE id = $1`,
			id, next.FirstName, next.LastName, next.Code, next.HeightCm, next.ClothingSize, next.ShoeSize,
			next.Notes, next.UpdatedAt, next.UpdatedByUserID, next.DeletedAt, next.DeletedByUserID); err != nil {
			return err
		}
		if err := insertEvent(ctx, tx, ev); err != nil {
			return err
		}
		out = next
		return nil
	})
	return out, translate(err)
}

func insertEvent(ctx context.Context, tx pgx.Tx, ev *audit.Event) error {
	if ev == nil {
		return nil
	}
	return audit.Insert(ctx, tx, *ev)
}

// escapeLike makes q match literally inside a LIKE pattern.
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}

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
