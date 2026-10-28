package settings

import (
	"context"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores the settings in app_settings (migration 0018), one
// row at most, and its SIM providers in sim_providers (migration 0039), which
// go with the row.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const columns = `company_name, supplier_chat_name, supplier_chat_link, default_sim_provider, default_sim_non_return_value_cents,
	updated_at, updated_by_user_id`

// querier is what reading needs, the pool or a transaction.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// read reads the row (locking it when lock is set) and its providers; no row
// is the defaults.
func read(ctx context.Context, q querier, lock bool) (Settings, error) {
	sql := `SELECT ` + columns + ` FROM app_settings`
	if lock {
		sql += ` FOR UPDATE`
	}
	var s Settings
	err := q.QueryRow(ctx, sql).Scan(&s.CompanyName, &s.SupplierChat.Name, &s.SupplierChat.Link, &s.DefaultSIMProvider,
		&s.DefaultSIMNonReturnValueCents, &s.UpdatedAt, &s.UpdatedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{SIMProviders: []SIMProvider{}}, nil
	}
	if err != nil {
		return Settings{}, err
	}
	s.UpdatedAt = s.UpdatedAt.UTC()
	rows, err := q.Query(ctx, `SELECT name, email, default_plan FROM sim_providers ORDER BY position`)
	if err != nil {
		return Settings{}, err
	}
	s.SIMProviders, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (SIMProvider, error) {
		var p SIMProvider
		return p, row.Scan(&p.Name, &p.Email, &p.DefaultPlan)
	})
	return s, err
}

func (r *PostgresRepository) Get(ctx context.Context) (Settings, error) {
	return read(ctx, r.pool, false)
}

func (r *PostgresRepository) Update(ctx context.Context, m Mutation) (Settings, error) {
	var out Settings
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := read(ctx, tx, true)
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
			INSERT INTO app_settings (`+columns+`) VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (singleton) DO UPDATE SET company_name = EXCLUDED.company_name,
				supplier_chat_name = EXCLUDED.supplier_chat_name, supplier_chat_link = EXCLUDED.supplier_chat_link,
				default_sim_provider = EXCLUDED.default_sim_provider,
				default_sim_non_return_value_cents = EXCLUDED.default_sim_non_return_value_cents,
				updated_at = EXCLUDED.updated_at, updated_by_user_id = EXCLUDED.updated_by_user_id`,
			next.CompanyName, next.SupplierChat.Name, next.SupplierChat.Link, next.DefaultSIMProvider, next.DefaultSIMNonReturnValueCents,
			next.UpdatedAt, next.UpdatedByUserID); err != nil {
			return err
		}
		// The providers are written again as a list: the row's lock covers them.
		if !slices.Equal(next.SIMProviders, cur.SIMProviders) {
			if _, err := tx.Exec(ctx, `DELETE FROM sim_providers`); err != nil {
				return err
			}
			for i, p := range next.SIMProviders {
				if _, err := tx.Exec(ctx, `INSERT INTO sim_providers (position, name, email, default_plan) VALUES ($1, $2, $3, $4)`,
					i, p.Name, p.Email, p.DefaultPlan); err != nil {
					return err
				}
			}
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
