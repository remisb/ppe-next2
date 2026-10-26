package employeephoto

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores photos in employee_photos (migration 0037).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const columns = `p.id, p.employee_id, p.object_key, p.file_name, p.content_type, p.size_bytes, p.sha256, p.uses,
	p.is_default, p.uploaded_at, p.uploaded_by_user_id`

func scan(row pgx.Row) (Photo, error) {
	var p Photo
	err := row.Scan(&p.ID, &p.EmployeeID, &p.ObjectKey, &p.FileName, &p.ContentType, &p.SizeBytes, &p.SHA256, &p.Uses,
		&p.IsDefault, &p.UploadedAt, &p.UploadedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Photo{}, ErrNotFound
	}
	if err != nil {
		return Photo{}, err
	}
	p.UploadedAt = p.UploadedAt.UTC()
	if p.Uses == nil {
		p.Uses = []string{}
	}
	return p, nil
}

type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func live(ctx context.Context, q queryer, employeeID uuid.UUID) ([]Photo, error) {
	rows, err := q.Query(ctx, `SELECT `+columns+` FROM employee_photos p
		WHERE p.employee_id = $1 AND p.deleted_at IS NULL ORDER BY p.uploaded_at, p.id`, employeeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Photo, 0)
	for rows.Next() {
		p, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func exists(ctx context.Context, q queryer, employeeID uuid.UUID, lock bool) error {
	sql := `SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL`
	if lock {
		sql += ` FOR UPDATE`
	}
	var one int
	err := q.QueryRow(ctx, sql, employeeID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrEmployeeNotFound
	}
	return err
}

func (r *PostgresRepository) List(ctx context.Context, employeeID uuid.UUID) ([]Photo, error) {
	if err := exists(ctx, r.pool, employeeID, false); err != nil {
		return nil, err
	}
	return live(ctx, r.pool, employeeID)
}

func (r *PostgresRepository) Photo(ctx context.Context, employeeID, photoID uuid.UUID) (Photo, error) {
	return scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM employee_photos p
		JOIN employees e ON e.id = p.employee_id
		WHERE p.id = $1 AND p.employee_id = $2 AND p.deleted_at IS NULL AND e.deleted_at IS NULL`, photoID, employeeID))
}

func (r *PostgresRepository) Apply(ctx context.Context, employeeID uuid.UUID, fn Change) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if err := exists(ctx, tx, employeeID, true); err != nil {
			return err
		}
		cur, err := live(ctx, tx, employeeID)
		if err != nil {
			return err
		}
		next, evs, err := fn(cur)
		if err != nil {
			return err
		}
		// Rows that stop being the default go first, so the unique index
		// never sees two defaults.
		for _, wantDefault := range []bool{false, true} {
			for _, p := range next {
				if (p.IsDefault && p.DeletedAt == nil) != wantDefault {
					continue
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO employee_photos (id, employee_id, object_key, file_name, content_type, size_bytes, sha256,
						uses, is_default, uploaded_at, uploaded_by_user_id, deleted_at, deleted_by_user_id)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
					ON CONFLICT (id) DO UPDATE SET uses = EXCLUDED.uses, is_default = EXCLUDED.is_default,
						deleted_at = EXCLUDED.deleted_at, deleted_by_user_id = EXCLUDED.deleted_by_user_id`,
					p.ID, p.EmployeeID, p.ObjectKey, p.FileName, p.ContentType, p.SizeBytes, p.SHA256, p.Uses, p.IsDefault,
					p.UploadedAt, p.UploadedByUserID, p.DeletedAt, p.DeletedByUserID); err != nil {
					return err
				}
			}
		}
		return audit.InsertAll(ctx, tx, evs)
	}))
}

func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	if pgErr.Code == "23503" {
		return ErrActorNotFound
	}
	return err
}
