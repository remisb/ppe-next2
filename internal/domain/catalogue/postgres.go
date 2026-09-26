package catalogue

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

// PostgresRepository stores items in catalogue_items (migration 0004).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const columns = `id, name, details, size_group, unit_price_cents, currency, service_period_months,
	active, display_rank, created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, deleted_by_user_id`

const selectorOrder = `ORDER BY display_rank, lower(name), id`

func scan(row pgx.Row) (Item, error) {
	var i Item
	err := row.Scan(&i.ID, &i.Name, &i.Details, &i.SizeGroup, &i.UnitPriceCents, &i.Currency, &i.ServicePeriodMonths,
		&i.Active, &i.DisplayRank, &i.CreatedAt, &i.UpdatedAt, &i.DeletedAt, &i.CreatedByUserID, &i.UpdatedByUserID, &i.DeletedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if err != nil {
		return Item{}, err
	}
	i.CreatedAt, i.UpdatedAt = i.CreatedAt.UTC(), i.UpdatedAt.UTC()
	return i, nil
}

func (r *PostgresRepository) query(ctx context.Context, sql string, args ...any) ([]Item, error) {
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Item, 0)
	for rows.Next() {
		i, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (r *PostgresRepository) Create(ctx context.Context, i Item, ev *audit.Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO catalogue_items (id, name, details, size_group, unit_price_cents, currency,
				service_period_months, active, display_rank, created_at, updated_at, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			i.ID, i.Name, i.Details, i.SizeGroup, i.UnitPriceCents, i.Currency, i.ServicePeriodMonths,
			i.Active, i.DisplayRank, i.CreatedAt, i.UpdatedAt, i.CreatedByUserID, i.UpdatedByUserID); err != nil {
			return err
		}
		return insertEvent(ctx, tx, ev)
	}))
}

func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Item, error) {
	return scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM catalogue_items WHERE id = $1 AND deleted_at IS NULL`, id))
}

func (r *PostgresRepository) List(ctx context.Context) ([]Item, error) {
	return r.query(ctx, `SELECT `+columns+` FROM catalogue_items WHERE deleted_at IS NULL `+selectorOrder)
}

func (r *PostgresRepository) ListActive(ctx context.Context) ([]Item, error) {
	return r.query(ctx, `SELECT `+columns+` FROM catalogue_items WHERE deleted_at IS NULL AND active `+selectorOrder)
}

func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Item, error) {
	var out Item
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx,
			`SELECT `+columns+` FROM catalogue_items WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id))
		if err != nil {
			return err
		}
		next, ev, err := m(cur)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE catalogue_items SET name = $2, details = $3, size_group = $4, unit_price_cents = $5,
				service_period_months = $6, active = $7, display_rank = $8, updated_at = $9,
				updated_by_user_id = $10, deleted_at = $11, deleted_by_user_id = $12
			WHERE id = $1`,
			id, next.Name, next.Details, next.SizeGroup, next.UnitPriceCents, next.ServicePeriodMonths,
			next.Active, next.DisplayRank, next.UpdatedAt, next.UpdatedByUserID, next.DeletedAt, next.DeletedByUserID); err != nil {
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

func (r *PostgresRepository) PriceHistory(ctx context.Context, id uuid.UUID) ([]PriceEntry, error) {
	rows, err := r.pool.Query(ctx, `SELECT a.occurred_at, a.event, u.name,
			(a.after ->> 'unit_price_cents')::bigint, (a.after ->> 'service_period_months')::int,
			(a.before ->> 'unit_price_cents')::bigint, (a.before ->> 'service_period_months')::int
		FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
		WHERE a.entity_type = $1 AND a.entity_id = $2 AND a.event IN ($3, $4)
		ORDER BY a.occurred_at DESC, a.id DESC`, auditEntity, id, EventCreated, EventPriceChanged)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PriceEntry, error) {
		var e PriceEntry
		err := row.Scan(&e.At, &e.Event, &e.ByName, &e.UnitPriceCents, &e.ServicePeriodMonths, &e.BeforeCents, &e.BeforeServiceMonths)
		e.At = e.At.UTC()
		return e, err
	})
}

func insertEvent(ctx context.Context, tx pgx.Tx, ev *audit.Event) error {
	if ev == nil {
		return nil
	}
	return audit.Insert(ctx, tx, *ev)
}

func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505":
		return ErrNameTaken
	case "23503":
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
