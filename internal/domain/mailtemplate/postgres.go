package mailtemplate

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores the saved templates in mail_templates (migration
// 0040), one row per use case that was saved.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const columns = `key, recipient, cc, subject, body, updated_at, updated_by_user_id`

func scan(row pgx.Row) (Template, error) {
	var t Template
	err := row.Scan(&t.Key, &t.To, &t.CC, &t.Subject, &t.Body, &t.UpdatedAt, &t.UpdatedByUserID)
	if err != nil {
		return Template{}, err
	}
	if t.UpdatedAt != nil {
		at := t.UpdatedAt.UTC()
		t.UpdatedAt = &at
	}
	return t, nil
}

func (r *PostgresRepository) List(ctx context.Context) ([]Template, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+columns+` FROM mail_templates ORDER BY key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Template, 0)
	for rows.Next() {
		t, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *PostgresRepository) Get(ctx context.Context, key string) (Template, error) {
	t, err := scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM mail_templates WHERE key = $1`, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return Template{Key: key}, nil
	}
	return t, err
}

func (r *PostgresRepository) Update(ctx context.Context, key string, m Mutation) (Template, error) {
	var out Template
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM mail_templates WHERE key = $1 FOR UPDATE`, key))
		if errors.Is(err, pgx.ErrNoRows) {
			cur, err = Template{Key: key}, nil
		}
		if err != nil {
			return err
		}
		next, ev, err := m(cur)
		if err != nil {
			return err
		}
		out = next
		if ev == nil {
			return nil
		}
		// The first save inserts the row; two at once meet in the conflict clause.
		if _, err := tx.Exec(ctx, `
			INSERT INTO mail_templates (id, `+columns+`) VALUES ($8, $1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (key) DO UPDATE SET recipient = EXCLUDED.recipient, cc = EXCLUDED.cc, subject = EXCLUDED.subject,
				body = EXCLUDED.body, updated_at = EXCLUDED.updated_at, updated_by_user_id = EXCLUDED.updated_by_user_id`,
			key, next.To, next.CC, next.Subject, next.Body, next.UpdatedAt, next.UpdatedByUserID, EntityID(key)); err != nil {
			return err
		}
		return audit.Insert(ctx, tx, *ev)
	})
	return out, translate(err)
}

func translate(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return ErrActorNotFound
	}
	return err
}
