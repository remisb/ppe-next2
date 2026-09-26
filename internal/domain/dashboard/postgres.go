package dashboard

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresRepository reads the dashboard figures from the orders, order_lines,
// employees, catalogue_items, item_sets and users tables.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// lineTotal is an order's value from its snapshot lines.
const lineTotal = `(SELECT coalesce(sum(l.unit_price_cents * l.quantity), 0)::bigint FROM order_lines l WHERE l.order_id = o.id)`

// Read runs every query in one read-only REPEATABLE READ transaction, so the
// figures agree with each other even while orders are being confirmed.
func (r *PostgresRepository) Read(ctx context.Context, w Window) (Overview, error) {
	var o Overview
	err := pgx.BeginTxFunc(ctx, r.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		for _, read := range []func(context.Context, pgx.Tx, Window, *Overview) error{
			readAwaiting, readMonths, readConfirmation, readTopItems, readReplacements, readSetup,
		} {
			if err := read(ctx, tx, w, &o); err != nil {
				return err
			}
		}
		return nil
	})
	return o, err
}

func readAwaiting(ctx context.Context, tx pgx.Tx, w Window, o *Overview) error {
	if err := tx.QueryRow(ctx, `SELECT count(*), coalesce(sum(`+lineTotal+`), 0)::bigint
		FROM orders o WHERE o.status = 'ORDERED'`).Scan(&o.Awaiting.Orders, &o.Awaiting.ValueCents); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `SELECT o.id, o.record_seq, o.employee_id, o.employee_first_name || ' ' || o.employee_last_name,
			o.ordered_at, `+lineTotal+`
		FROM orders o WHERE o.status = 'ORDERED' ORDER BY o.ordered_at, o.id LIMIT $1`, w.Limit)
	if err != nil {
		return err
	}
	o.Awaiting.Longest, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Waiting, error) {
		var x Waiting
		err := row.Scan(&x.OrderID, &x.RecordSeq, &x.EmployeeID, &x.EmployeeName, &x.OrderedAt, &x.ValueCents)
		x.OrderedAt = x.OrderedAt.UTC()
		return x, err
	})
	return err
}

// readMonths buckets orders into the window's months: ordered figures by
// ordered_at, given figures by given_at. Every month gets a row.
func readMonths(ctx context.Context, tx pgx.Tx, w Window, o *Overview) error {
	n := len(w.MonthStarts) - 1
	rows, err := tx.Query(ctx, `
		WITH m AS (
			SELECT s, e, i FROM unnest($1::timestamptz[], $2::timestamptz[]) WITH ORDINALITY AS m (s, e, i)
		), t AS (
			SELECT o.ordered_at, o.given_at, sum(l.unit_price_cents * l.quantity)::bigint AS cents, sum(l.quantity)::bigint AS qty
			FROM orders o JOIN order_lines l ON l.order_id = o.id
			WHERE o.ordered_at >= $3 OR o.given_at >= $3
			GROUP BY o.id
		)
		SELECT
			(SELECT count(*) FROM t WHERE t.ordered_at >= m.s AND t.ordered_at < m.e),
			(SELECT coalesce(sum(cents), 0)::bigint FROM t WHERE t.ordered_at >= m.s AND t.ordered_at < m.e),
			(SELECT count(*) FROM t WHERE t.given_at >= m.s AND t.given_at < m.e),
			(SELECT coalesce(sum(qty), 0)::bigint FROM t WHERE t.given_at >= m.s AND t.given_at < m.e),
			(SELECT coalesce(sum(cents), 0)::bigint FROM t WHERE t.given_at >= m.s AND t.given_at < m.e)
		FROM m ORDER BY m.i`, w.MonthStarts[:n], w.MonthStarts[1:], w.MonthStarts[0])
	if err != nil {
		return err
	}
	o.Months, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Month, error) {
		var x Month
		err := row.Scan(&x.OrderedOrders, &x.OrderedCents, &x.GivenOrders, &x.GivenItems, &x.GivenCents)
		return x, err
	})
	return err
}

func readConfirmation(ctx context.Context, tx pgx.Tx, w Window, o *Overview) error {
	c := &o.Confirmation
	return tx.QueryRow(ctx, `SELECT count(*),
			count(*) FILTER (WHERE confirmation_method = 'ELECTRONIC'),
			count(*) FILTER (WHERE confirmation_method = 'PAPER'),
			percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM given_at - ordered_at))
		FROM orders WHERE status = 'GIVEN' AND given_at >= $1`, w.ConfirmSince).
		Scan(&c.Given, &c.Electronic, &c.Paper, &c.MedianSeconds)
}

func readTopItems(ctx context.Context, tx pgx.Tx, w Window, o *Overview) error {
	rows, err := tx.Query(ctx, `SELECT l.catalogue_item_id, (array_agg(l.item_name ORDER BY o.given_at DESC))[1],
			sum(l.quantity), sum(l.unit_price_cents * l.quantity)::bigint
		FROM order_lines l JOIN orders o ON o.id = l.order_id
		WHERE o.status = 'GIVEN' AND o.given_at >= $1
		GROUP BY l.catalogue_item_id
		ORDER BY 3 DESC, 4 DESC, 2 LIMIT $2`, w.MonthStarts[0], w.Limit)
	if err != nil {
		return err
	}
	o.TopItems, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (TopItem, error) {
		var x TopItem
		err := row.Scan(&x.CatalogueItemID, &x.ItemName, &x.Quantity, &x.ValueCents)
		return x, err
	})
	return err
}

// readReplacements takes each live employee's most recent GIVEN line per item
// and keeps those due before w.DueBy that are not already on an ORDERED order.
func readReplacements(ctx context.Context, tx pgx.Tx, w Window, o *Overview) error {
	rows, err := tx.Query(ctx, `
		WITH latest AS (
			SELECT DISTINCT ON (o.employee_id, l.catalogue_item_id)
				o.employee_id, l.catalogue_item_id, l.item_name, l.size, o.id AS order_id, o.record_seq, o.given_at,
				o.given_at + make_interval(months => l.service_period_months) AS due_at
			FROM order_lines l JOIN orders o ON o.id = l.order_id
			WHERE o.status = 'GIVEN'
			ORDER BY o.employee_id, l.catalogue_item_id, o.given_at DESC, l.line_no
		), due AS (
			SELECT d.*, e.first_name || ' ' || e.last_name AS name, e.code
			FROM latest d JOIN employees e ON e.id = d.employee_id AND e.deleted_at IS NULL
			WHERE d.due_at < $1 AND NOT EXISTS (
				SELECT 1 FROM orders p JOIN order_lines pl ON pl.order_id = p.id
				WHERE p.status = 'ORDERED' AND p.employee_id = d.employee_id AND pl.catalogue_item_id = d.catalogue_item_id)
		)
		SELECT employee_id, name, code, catalogue_item_id, item_name, size, order_id, record_seq, given_at, due_at,
			count(*) FILTER (WHERE due_at <= $2) OVER (), count(*) FILTER (WHERE due_at > $2) OVER ()
		FROM due ORDER BY due_at, name, item_name LIMIT $3`, w.DueBy, w.Now, w.Limit)
	if err != nil {
		return err
	}
	r := &o.Replacements
	r.Next, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Replacement, error) {
		var x Replacement
		err := row.Scan(&x.EmployeeID, &x.EmployeeName, &x.EmployeeCode, &x.CatalogueItemID, &x.ItemName, &x.Size,
			&x.OrderID, &x.RecordSeq, &x.GivenAt, &x.DueAt, &r.Overdue, &r.DueSoon)
		x.GivenAt, x.DueAt = x.GivenAt.UTC(), x.DueAt.UTC()
		return x, err
	})
	return err
}

func readSetup(ctx context.Context, tx pgx.Tx, _ Window, o *Overview) error {
	s := &o.Setup
	return tx.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM employees WHERE deleted_at IS NULL),
		(SELECT count(*) FROM employees WHERE deleted_at IS NULL
			AND (shoe_size IS NULL OR (clothing_size IS NULL AND height_cm IS NULL))),
		(SELECT count(*) FROM catalogue_items WHERE deleted_at IS NULL AND active),
		(SELECT count(*) FROM catalogue_items WHERE deleted_at IS NULL AND active
			AND (unit_price_cents IS NULL OR service_period_months IS NULL)),
		(SELECT count(*) FROM item_sets WHERE deleted_at IS NULL AND active),
		(SELECT count(*) FROM users WHERE deleted_at IS NULL AND is_active),
		(SELECT count(*) FROM users WHERE deleted_at IS NULL AND is_active AND 'admin' = ANY (roles))`).
		Scan(&s.Employees, &s.EmployeesMissingSizes, &s.CatalogueActive, &s.CatalogueUnpriced, &s.ItemSetsActive, &s.Users, &s.Admins)
}
