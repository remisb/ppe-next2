package settings

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores the settings in app_settings (migration 0018), one row at most.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const columns = `supplier_chat_name, supplier_chat_link, default_sim_provider, updated_at, updated_by_user_id`

// scan reads the row; no row is the defaults.
func scan(row pgx.Row) (Settings, error) {
	var s Settings
	err := row.Scan(&s.SupplierChat.Name, &s.SupplierChat.Link, &s.DefaultSIMProvider, &s.UpdatedAt, &s.UpdatedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{}, nil
	}
	if err != nil {
		return Settings{}, err
	}
	s.UpdatedAt = s.UpdatedAt.UTC()
	return s, nil
}

func (r *PostgresRepository) Get(ctx context.Context) (Settings, error) {
	return scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM app_settings`))
}

func (r *PostgresRepository) Update(ctx context.Context, m Mutation) (Settings, error) {
	var out Settings
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM app_settings FOR UPDATE`))
		if err != nil {
			return err
		}
		next, ev, err := m(cur)
		if err != nil {
			return err
		}
		if ev == nil {
			out = next
			return nil
		}
		// The first write inserts the row; two at once meet in the conflict clause.
		if _, err := tx.Exec(ctx, `
			INSERT INTO app_settings (`+columns+`) VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (singleton) DO UPDATE SET supplier_chat_name = EXCLUDED.supplier_chat_name,
				supplier_chat_link = EXCLUDED.supplier_chat_link, default_sim_provider = EXCLUDED.default_sim_provider,
				updated_at = EXCLUDED.updated_at, updated_by_user_id = EXCLUDED.updated_by_user_id`,
			next.SupplierChat.Name, next.SupplierChat.Link, next.DefaultSIMProvider, next.UpdatedAt, next.UpdatedByUserID); err != nil {
			return err
		}
		if err := audit.Insert(ctx, tx, *ev); err != nil {
			return err
		}
		out = next
		return nil
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
