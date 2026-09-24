package order

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores orders and their snapshot lines (migration 0006).
// Inside Mark as Ordered it also reads employees, catalogue_items and users:
// the copy into the snapshot must see exactly the rows it locks.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

func (r *PostgresRepository) Create(ctx context.Context, employeeID uuid.UUID, itemIDs []uuid.UUID, preparer uuid.UUID, build Build) (Order, error) {
	var out Order
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		snap, err := readSnapshot(ctx, tx, employeeID, itemIDs, preparer)
		if err != nil {
			return err
		}
		o, ev, err := build(snap)
		if err != nil {
			return err
		}
		if err := insertOrder(ctx, tx, o); err != nil {
			return err
		}
		if err := audit.Insert(ctx, tx, ev); err != nil {
			return err
		}
		out = o
		return nil
	})
	return out, translate(err)
}

func readSnapshot(ctx context.Context, tx pgx.Tx, employeeID uuid.UUID, itemIDs []uuid.UUID, preparer uuid.UUID) (Snapshot, error) {
	var s Snapshot
	// FOR SHARE: the employee and items cannot be changed or deleted until the
	// order commits, so the snapshot matches what was locked.
	err := tx.QueryRow(ctx, `SELECT id, first_name, last_name, code FROM employees
		WHERE id = $1 AND deleted_at IS NULL FOR SHARE`, employeeID).
		Scan(&s.Employee.ID, &s.Employee.FirstName, &s.Employee.LastName, &s.Employee.Code)
	if errors.Is(err, pgx.ErrNoRows) {
		return Snapshot{}, ErrEmployeeNotFound
	}
	if err != nil {
		return Snapshot{}, err
	}

	err = tx.QueryRow(ctx, `SELECT name FROM users WHERE id = $1 AND deleted_at IS NULL`, preparer).Scan(&s.PreparedByName)
	if errors.Is(err, pgx.ErrNoRows) {
		return Snapshot{}, ErrActorNotFound
	}
	if err != nil {
		return Snapshot{}, err
	}

	rows, err := tx.Query(ctx, `SELECT id, name, details, size_group, unit_price_cents, currency,
			service_period_months, active
		FROM catalogue_items WHERE id = ANY($1) AND deleted_at IS NULL
		ORDER BY id FOR SHARE`, itemIDs)
	if err != nil {
		return Snapshot{}, err
	}
	s.Items = make(map[uuid.UUID]ItemView, len(itemIDs))
	for rows.Next() {
		var it ItemView
		if err := rows.Scan(&it.ID, &it.Name, &it.Details, &it.SizeGroup, &it.UnitPriceCents, &it.Currency,
			&it.ServicePeriodMonths, &it.Active); err != nil {
			rows.Close()
			return Snapshot{}, err
		}
		s.Items[it.ID] = it
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return Snapshot{}, err
	}

	if err := tx.QueryRow(ctx, `SELECT nextval('order_record_seq')`).Scan(&s.RecordSeq); err != nil {
		return Snapshot{}, err
	}
	return s, nil
}

func insertOrder(ctx context.Context, tx pgx.Tx, o Order) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO orders (id, record_seq, employee_id, employee_first_name, employee_last_name, employee_code,
			status, ordered_at, prepared_by_user_id, prepared_by_name, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		o.ID, o.RecordSeq, o.EmployeeID, o.EmployeeFirstName, o.EmployeeLastName, o.EmployeeCode,
		o.Status, o.OrderedAt, o.PreparedByUserID, o.PreparedByName, o.UpdatedAt); err != nil {
		return err
	}
	for _, l := range o.Lines {
		if _, err := tx.Exec(ctx, `
			INSERT INTO order_lines (id, order_id, line_no, catalogue_item_id, item_name, item_details, size_group,
				size, quantity, unit_price_cents, currency, service_period_months)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			l.ID, o.ID, l.LineNo, l.CatalogueItemID, l.ItemName, l.ItemDetails, l.SizeGroup,
			l.Size, l.Quantity, l.UnitPriceCents, l.Currency, l.ServicePeriodMonths); err != nil {
			return err
		}
	}
	return nil
}

const orderColumns = `id, record_seq, employee_id, employee_first_name, employee_last_name, employee_code,
	status, ordered_at, prepared_by_user_id, prepared_by_name, given_at, given_by_user_id, given_by_name,
	confirmation_method, updated_at, updated_by_user_id`

func scanOrder(row pgx.Row) (Order, error) {
	var o Order
	err := row.Scan(&o.ID, &o.RecordSeq, &o.EmployeeID, &o.EmployeeFirstName, &o.EmployeeLastName, &o.EmployeeCode,
		&o.Status, &o.OrderedAt, &o.PreparedByUserID, &o.PreparedByName, &o.GivenAt, &o.GivenByUserID, &o.GivenByName,
		&o.ConfirmationMethod, &o.UpdatedAt, &o.UpdatedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Order{}, ErrNotFound
	}
	if err != nil {
		return Order{}, err
	}
	o.OrderedAt, o.UpdatedAt = o.OrderedAt.UTC(), o.UpdatedAt.UTC()
	if o.GivenAt != nil {
		t := o.GivenAt.UTC()
		o.GivenAt = &t
	}
	o.Lines = make([]Line, 0)
	return o, nil
}

func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Order, error) {
	o, err := scanOrder(r.pool.QueryRow(ctx, `SELECT `+orderColumns+` FROM orders WHERE id = $1`, id))
	if err != nil {
		return Order{}, err
	}
	orders, err := r.withLines(ctx, []Order{o})
	if err != nil {
		return Order{}, err
	}
	return orders[0], nil
}

// activity is the History sort and date-filter key; orders_activity_idx covers it.
const activity = `coalesce(given_at, ordered_at)`

func (r *PostgresRepository) List(ctx context.Context, f ListFilter) ([]Order, int, error) {
	where := `TRUE`
	var args []any
	add := func(cond string, v any) {
		args = append(args, v)
		where += fmt.Sprintf(" AND "+cond, len(args))
	}
	if f.EmployeeID != nil {
		add(`employee_id = $%d`, *f.EmployeeID)
	}
	if f.Status != nil {
		add(`status = $%d`, string(*f.Status))
	}
	if f.From != nil {
		add(activity+` >= $%d`, *f.From)
	}
	if f.To != nil {
		add(activity+` < $%d`, *f.To)
	}

	var total int
	if err := r.pool.QueryRow(ctx, `SELECT count(*) FROM orders WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.pool.Query(ctx, fmt.Sprintf(`SELECT `+orderColumns+` FROM orders WHERE `+where+`
		ORDER BY `+activity+` DESC, id DESC LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2),
		append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	orders := make([]Order, 0, f.Limit)
	for rows.Next() {
		o, err := scanOrder(rows)
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		orders = append(orders, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	orders, err = r.withLines(ctx, orders)
	return orders, total, err
}

// withLines loads the snapshot lines of orders in one query.
func (r *PostgresRepository) withLines(ctx context.Context, orders []Order) ([]Order, error) {
	if len(orders) == 0 {
		return orders, nil
	}
	ids := make([]uuid.UUID, len(orders))
	index := make(map[uuid.UUID]int, len(orders))
	for i, o := range orders {
		ids[i], index[o.ID] = o.ID, i
	}
	rows, err := r.pool.Query(ctx, `SELECT order_id, id, line_no, catalogue_item_id, item_name, item_details, size_group,
			size, quantity, unit_price_cents, currency, service_period_months
		FROM order_lines WHERE order_id = ANY($1) ORDER BY order_id, line_no`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var orderID uuid.UUID
		var l Line
		if err := rows.Scan(&orderID, &l.ID, &l.LineNo, &l.CatalogueItemID, &l.ItemName, &l.ItemDetails, &l.SizeGroup,
			&l.Size, &l.Quantity, &l.UnitPriceCents, &l.Currency, &l.ServicePeriodMonths); err != nil {
			return nil, err
		}
		i := index[orderID]
		orders[i].Lines = append(orders[i].Lines, l)
	}
	return orders, rows.Err()
}

const confirmationColumns = `id, order_id, method, token_hash, expires_at, revoked_at, confirmed_at,
	confirmed_name, document_hash, created_at, created_by_user_id`

func scanConfirmation(row pgx.Row) (Confirmation, error) {
	var c Confirmation
	err := row.Scan(&c.ID, &c.OrderID, &c.Method, &c.TokenHash, &c.ExpiresAt, &c.RevokedAt, &c.ConfirmedAt,
		&c.ConfirmedName, &c.DocumentHash, &c.CreatedAt, &c.CreatedByUserID)
	if err != nil {
		return Confirmation{}, err
	}
	c.CreatedAt = c.CreatedAt.UTC()
	for _, t := range []**time.Time{&c.ExpiresAt, &c.RevokedAt, &c.ConfirmedAt} {
		if *t != nil {
			u := (*t).UTC()
			*t = &u
		}
	}
	return c, nil
}

// lockOrder locks an order row for the rest of the transaction and loads it
// with its lines.
func lockOrder(ctx context.Context, tx pgx.Tx, id uuid.UUID) (Order, error) {
	o, err := scanOrder(tx.QueryRow(ctx, `SELECT `+orderColumns+` FROM orders WHERE id = $1 FOR UPDATE`, id))
	if err != nil {
		return Order{}, err
	}
	rows, err := tx.Query(ctx, `SELECT id, line_no, catalogue_item_id, item_name, item_details, size_group,
			size, quantity, unit_price_cents, currency, service_period_months
		FROM order_lines WHERE order_id = $1 ORDER BY line_no`, id)
	if err != nil {
		return Order{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var l Line
		if err := rows.Scan(&l.ID, &l.LineNo, &l.CatalogueItemID, &l.ItemName, &l.ItemDetails, &l.SizeGroup,
			&l.Size, &l.Quantity, &l.UnitPriceCents, &l.Currency, &l.ServicePeriodMonths); err != nil {
			return Order{}, err
		}
		o.Lines = append(o.Lines, l)
	}
	return o, rows.Err()
}

// revokeUnused revokes an order's electronic links that were never used.
func revokeUnused(ctx context.Context, tx pgx.Tx, orderID uuid.UUID, at time.Time, except *uuid.UUID) error {
	_, err := tx.Exec(ctx, `UPDATE order_confirmations SET revoked_at = $2
		WHERE order_id = $1 AND method = 'ELECTRONIC' AND revoked_at IS NULL AND confirmed_at IS NULL
			AND ($3::uuid IS NULL OR id <> $3)`, orderID, at, except)
	return err
}

func insertConfirmation(ctx context.Context, tx pgx.Tx, c Confirmation) error {
	_, err := tx.Exec(ctx, `INSERT INTO order_confirmations (id, order_id, method, token_hash, expires_at,
			confirmed_at, confirmed_name, document_hash, created_at, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		c.ID, c.OrderID, c.Method, c.TokenHash, c.ExpiresAt, c.ConfirmedAt, c.ConfirmedName, c.DocumentHash,
		c.CreatedAt, c.CreatedByUserID)
	return err
}

func (r *PostgresRepository) CreateLink(ctx context.Context, orderID uuid.UUID, fn LinkFunc) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		o, err := lockOrder(ctx, tx, orderID)
		if err != nil {
			return err
		}
		c, ev, err := fn(o)
		if err != nil {
			return err
		}
		if err := revokeUnused(ctx, tx, orderID, c.CreatedAt, nil); err != nil {
			return err
		}
		if err := insertConfirmation(ctx, tx, c); err != nil {
			return err
		}
		return audit.Insert(ctx, tx, ev)
	}))
}

func (r *PostgresRepository) LinkByHash(ctx context.Context, tokenHash string) (Confirmation, error) {
	c, err := scanConfirmation(r.pool.QueryRow(ctx,
		`SELECT `+confirmationColumns+` FROM order_confirmations WHERE token_hash = $1`, tokenHash))
	if errors.Is(err, pgx.ErrNoRows) {
		return Confirmation{}, ErrLinkExpired
	}
	return c, err
}

func (r *PostgresRepository) Confirm(ctx context.Context, orderID uuid.UUID, linkID *uuid.UUID, giver uuid.UUID, fn ConfirmFunc) (Order, error) {
	var out Order
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		o, err := lockOrder(ctx, tx, orderID)
		if err != nil {
			return err
		}
		snap := ConfirmSnapshot{Order: o}
		if linkID != nil {
			l, err := scanConfirmation(tx.QueryRow(ctx,
				`SELECT `+confirmationColumns+` FROM order_confirmations WHERE id = $1 FOR UPDATE`, *linkID))
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrLinkExpired
			}
			if err != nil {
				return err
			}
			snap.Link = &l
		}
		err = tx.QueryRow(ctx, `SELECT name FROM users WHERE id = $1`, giver).Scan(&snap.GiverName)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrActorNotFound
		}
		if err != nil {
			return err
		}

		res, err := fn(snap)
		if err != nil {
			return err
		}
		if res.Noop {
			out = o
			return nil
		}
		g := res.Order
		tag, err := tx.Exec(ctx, `UPDATE orders SET status = $2, given_at = $3, given_by_user_id = $4, given_by_name = $5,
				confirmation_method = $6, updated_at = $7, updated_by_user_id = $8
			WHERE id = $1 AND status = 'ORDERED'`,
			g.ID, g.Status, g.GivenAt, g.GivenByUserID, g.GivenByName, g.ConfirmationMethod, g.UpdatedAt, g.UpdatedByUserID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return ErrNotOrdered
		}
		c := res.Confirmation
		if res.IsNew {
			err = insertConfirmation(ctx, tx, c)
		} else {
			_, err = tx.Exec(ctx, `UPDATE order_confirmations SET confirmed_at = $2, confirmed_name = $3, document_hash = $4
				WHERE id = $1`, c.ID, c.ConfirmedAt, c.ConfirmedName, c.DocumentHash)
		}
		if err != nil {
			return err
		}
		if err := revokeUnused(ctx, tx, orderID, *g.GivenAt, &c.ID); err != nil {
			return err
		}
		if err := audit.Insert(ctx, tx, res.Event); err != nil {
			return err
		}
		out = g
		return nil
	})
	return out, translate(err)
}

func (r *PostgresRepository) ConfirmedFor(ctx context.Context, orderID uuid.UUID) (Confirmation, error) {
	c, err := scanConfirmation(r.pool.QueryRow(ctx, `SELECT `+confirmationColumns+` FROM order_confirmations
		WHERE order_id = $1 AND confirmed_at IS NOT NULL`, orderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Confirmation{}, ErrNotFound
	}
	return c, err
}

func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505":
		// order_confirmations_one_confirmed_idx: a concurrent confirmation won.
		return ErrNotOrdered
	case "23503":
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
