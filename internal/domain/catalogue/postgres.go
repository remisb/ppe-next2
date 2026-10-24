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

// PostgresRepository stores items in catalogue_items (migration 0004) and
// pictures in catalogue_pictures (0036), where an item's size group is read.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// columns are an item's, read from items (i) joined to their pictures (p).
const columns = `i.id, i.name, i.details, p.size_group, i.purchase_price_cents, i.accounting_price_cents, i.currency,
	i.service_period_months, i.active, i.display_rank, i.icon, i.created_at, i.updated_at, i.deleted_at,
	i.created_by_user_id, i.updated_by_user_id, i.deleted_by_user_id`

const from = ` FROM catalogue_items i JOIN catalogue_pictures p ON p.icon = i.icon`

const selectorOrder = `ORDER BY i.display_rank, lower(i.name), i.id`

func scan(row pgx.Row) (Item, error) {
	var i Item
	err := row.Scan(&i.ID, &i.Name, &i.Details, &i.SizeGroup, &i.PurchasePriceCents, &i.AccountingPriceCents, &i.Currency, &i.ServicePeriodMonths,
		&i.Active, &i.DisplayRank, &i.Icon, &i.CreatedAt, &i.UpdatedAt, &i.DeletedAt, &i.CreatedByUserID, &i.UpdatedByUserID, &i.DeletedByUserID)
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

func (r *PostgresRepository) Create(ctx context.Context, i Item, ev *audit.Event) (Item, error) {
	var out Item
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO catalogue_items (id, name, details, accounting_price_cents, currency,
				service_period_months, active, display_rank, icon, created_at, updated_at, created_by_user_id, updated_by_user_id,
				purchase_price_cents)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
			i.ID, i.Name, i.Details, i.AccountingPriceCents, i.Currency, i.ServicePeriodMonths,
			i.Active, i.DisplayRank, i.Icon, i.CreatedAt, i.UpdatedAt, i.CreatedByUserID, i.UpdatedByUserID,
			i.PurchasePriceCents); err != nil {
			return err
		}
		if err := insertEvent(ctx, tx, ev); err != nil {
			return err
		}
		var err error
		out, err = scan(tx.QueryRow(ctx, `SELECT `+columns+from+` WHERE i.id = $1`, i.ID))
		return err
	})
	return out, translate(err)
}

func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Item, error) {
	return scan(r.pool.QueryRow(ctx, `SELECT `+columns+from+` WHERE i.id = $1 AND i.deleted_at IS NULL`, id))
}

func (r *PostgresRepository) List(ctx context.Context) ([]Item, error) {
	return r.query(ctx, `SELECT `+columns+from+` WHERE i.deleted_at IS NULL `+selectorOrder)
}

func (r *PostgresRepository) ListActive(ctx context.Context) ([]Item, error) {
	return r.query(ctx, `SELECT `+columns+from+` WHERE i.deleted_at IS NULL AND i.active `+selectorOrder)
}

func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Item, error) {
	var out Item
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx,
			`SELECT `+columns+from+` WHERE i.id = $1 AND i.deleted_at IS NULL FOR UPDATE OF i`, id))
		if err != nil {
			return err
		}
		next, evs, err := m(cur)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE catalogue_items SET name = $2, details = $3, accounting_price_cents = $4,
				service_period_months = $5, active = $6, display_rank = $7, updated_at = $8,
				updated_by_user_id = $9, deleted_at = $10, deleted_by_user_id = $11, icon = $12,
				purchase_price_cents = $13
			WHERE id = $1`,
			id, next.Name, next.Details, next.AccountingPriceCents, next.ServicePeriodMonths,
			next.Active, next.DisplayRank, next.UpdatedAt, next.UpdatedByUserID, next.DeletedAt, next.DeletedByUserID, next.Icon,
			next.PurchasePriceCents); err != nil {
			return err
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		// Read back, so a new picture brings its size group.
		out, err = scan(tx.QueryRow(ctx, `SELECT `+columns+from+` WHERE i.id = $1`, id))
		return err
	})
	return out, translate(err)
}

// pictureColumns are a picture's, with its live items counted.
const pictureColumns = `p.id, p.icon, p.size_group,
	(SELECT count(*) FROM catalogue_items i WHERE i.icon = p.icon AND i.deleted_at IS NULL)`

func scanPicture(row pgx.Row) (Picture, error) {
	var p Picture
	err := row.Scan(&p.ID, &p.Icon, &p.SizeGroup, &p.ItemCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return Picture{}, ErrPictureNotFound
	}
	return p, err
}

func iconOrder() []string {
	out := make([]string, len(Icons))
	for n, i := range Icons {
		out[n] = string(i)
	}
	return out
}

func (r *PostgresRepository) Pictures(ctx context.Context) ([]Picture, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+pictureColumns+` FROM catalogue_pictures p
		ORDER BY array_position($1::text[], p.icon), p.icon`, iconOrder())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Picture, 0, len(Icons))
	for rows.Next() {
		p, err := scanPicture(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *PostgresRepository) UpdatePicture(ctx context.Context, icon Icon, m PictureMutation) (Picture, error) {
	var out Picture
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scanPicture(tx.QueryRow(ctx, `SELECT `+pictureColumns+` FROM catalogue_pictures p WHERE p.icon = $1 FOR UPDATE`, icon))
		if err != nil {
			return err
		}
		next, evs, err := m(cur)
		if err != nil {
			return err
		}
		if len(evs) > 0 {
			if _, err := tx.Exec(ctx, `UPDATE catalogue_pictures SET size_group = $2 WHERE icon = $1`, icon, next.SizeGroup); err != nil {
				return err
			}
			if err := audit.InsertAll(ctx, tx, evs); err != nil {
				return err
			}
		}
		out = next
		return nil
	})
	return out, translate(err)
}

// PriceHistory reads the accounting price under its pre-0021 key
// unit_price_cents too (see priceSnapshot).
func (r *PostgresRepository) PriceHistory(ctx context.Context, id uuid.UUID) ([]PriceEntry, error) {
	rows, err := r.pool.Query(ctx, `SELECT a.occurred_at, a.event, u.name,
			(a.after ->> 'purchase_price_cents')::bigint,
			coalesce(a.after ->> 'accounting_price_cents', a.after ->> 'unit_price_cents')::bigint,
			(a.after ->> 'service_period_months')::int,
			(a.before ->> 'purchase_price_cents')::bigint,
			coalesce(a.before ->> 'accounting_price_cents', a.before ->> 'unit_price_cents')::bigint,
			(a.before ->> 'service_period_months')::int
		FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
		WHERE a.entity_type = $1 AND a.entity_id = $2 AND a.event IN ($3, $4)
		ORDER BY a.occurred_at DESC, a.id DESC`, auditEntity, id, EventCreated, EventPriceChanged)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (PriceEntry, error) {
		var e PriceEntry
		err := row.Scan(&e.At, &e.Event, &e.ByName, &e.PurchasePriceCents, &e.AccountingPriceCents, &e.ServicePeriodMonths,
			&e.BeforePurchaseCents, &e.BeforeAccountingCents, &e.BeforeServiceMonths)
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
		if pgErr.ConstraintName == "catalogue_items_icon_fkey" {
			return fmt.Errorf("%w: icon is not a known pictogram", ErrInvalid)
		}
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
