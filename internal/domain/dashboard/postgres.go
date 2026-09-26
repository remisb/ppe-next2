package dashboard

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/domain/catalogue"
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

func readReplacements(ctx context.Context, tx pgx.Tx, w Window, o *Overview) error {
	var err error
	o.Replacements, err = queryReplacements(ctx, tx, w.Now, w.DueBy, w.Limit)
	return err
}

// queryReplacements takes each live employee's most recent GIVEN line per item
// and keeps those due before dueBy that are not already on an ORDERED order.
func queryReplacements(ctx context.Context, tx pgx.Tx, now, dueBy time.Time, limit int) (Replacements, error) {
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
		FROM due ORDER BY due_at, name, item_name LIMIT $3`, dueBy, now, limit)
	if err != nil {
		return Replacements{}, err
	}
	var r Replacements
	r.Next, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Replacement, error) {
		var x Replacement
		err := row.Scan(&x.EmployeeID, &x.EmployeeName, &x.EmployeeCode, &x.CatalogueItemID, &x.ItemName, &x.Size,
			&x.OrderID, &x.RecordSeq, &x.GivenAt, &x.DueAt, &r.Overdue, &r.DueSoon)
		x.GivenAt, x.DueAt = x.GivenAt.UTC(), x.DueAt.UTC()
		return x, err
	})
	return r, err
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

// ReadManager runs the manager's queries in one read-only REPEATABLE READ transaction.
func (r *PostgresRepository) ReadManager(ctx context.Context, w ManagerWindow) (ManagerFigures, error) {
	var f ManagerFigures
	err := pgx.BeginTxFunc(ctx, r.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		for _, read := range []func(context.Context, pgx.Tx, ManagerWindow, *ManagerFigures) error{
			readOnOrder, readOrderedMonths, readSpendByItem, readForecast, readPriceChanges, readCatalogueCheck, readItemSetIssues, readSizeGroups,
		} {
			if err := read(ctx, tx, w, &f); err != nil {
				return err
			}
		}
		return nil
	})
	return f, err
}

func readOnOrder(ctx context.Context, tx pgx.Tx, _ ManagerWindow, f *ManagerFigures) error {
	o := &f.OnOrder
	return tx.QueryRow(ctx, `SELECT count(DISTINCT o.id), coalesce(sum(l.quantity), 0), coalesce(sum(l.unit_price_cents * l.quantity), 0)::bigint
		FROM orders o JOIN order_lines l ON l.order_id = o.id WHERE o.status = 'ORDERED'`).Scan(&o.Orders, &o.Items, &o.ValueCents)
}

// readOrderedMonths buckets orders by ordered_at into the window's months.
func readOrderedMonths(ctx context.Context, tx pgx.Tx, w ManagerWindow, f *ManagerFigures) error {
	n := len(w.MonthStarts) - 1
	rows, err := tx.Query(ctx, `
		WITH m AS (
			SELECT s, e, i FROM unnest($1::timestamptz[], $2::timestamptz[]) WITH ORDINALITY AS m (s, e, i)
		), t AS (
			SELECT o.ordered_at, sum(l.unit_price_cents * l.quantity)::bigint AS cents, sum(l.quantity)::bigint AS qty
			FROM orders o JOIN order_lines l ON l.order_id = o.id
			WHERE o.ordered_at >= $3
			GROUP BY o.id
		)
		SELECT count(t.ordered_at), coalesce(sum(t.qty), 0)::bigint, coalesce(sum(t.cents), 0)::bigint
		FROM m LEFT JOIN t ON t.ordered_at >= m.s AND t.ordered_at < m.e
		GROUP BY m.i ORDER BY m.i`, w.MonthStarts[:n], w.MonthStarts[1:], w.MonthStarts[0])
	if err != nil {
		return err
	}
	f.Months, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (OrderedMonth, error) {
		var x OrderedMonth
		err := row.Scan(&x.Orders, &x.Items, &x.ValueCents)
		return x, err
	})
	return err
}

// readSpendByItem ranks items by the value ordered over the window, from the snapshots.
func readSpendByItem(ctx context.Context, tx pgx.Tx, w ManagerWindow, f *ManagerFigures) error {
	rows, err := tx.Query(ctx, `SELECT l.catalogue_item_id, (array_agg(l.item_name ORDER BY o.ordered_at DESC))[1],
			sum(l.quantity), sum(l.unit_price_cents * l.quantity)::bigint
		FROM order_lines l JOIN orders o ON o.id = l.order_id
		WHERE o.ordered_at >= $1
		GROUP BY l.catalogue_item_id
		ORDER BY 4 DESC, 3 DESC, 2 LIMIT $2`, w.MonthStarts[0], w.Limit)
	if err != nil {
		return err
	}
	f.SpendByItem, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (TopItem, error) {
		var x TopItem
		err := row.Scan(&x.CatalogueItemID, &x.ItemName, &x.Quantity, &x.ValueCents)
		return x, err
	})
	return err
}

// readForecast groups by item the replacements due before w.ForecastBy (see
// Forecast), with the item's current price when it is active and complete.
// Every item is returned; the service totals them and keeps the largest.
func readForecast(ctx context.Context, tx pgx.Tx, w ManagerWindow, f *ManagerFigures) error {
	rows, err := tx.Query(ctx, `
		WITH latest AS (
			SELECT DISTINCT ON (o.employee_id, l.catalogue_item_id)
				o.employee_id, l.catalogue_item_id, l.item_name, l.quantity, o.given_at,
				o.given_at + make_interval(months => l.service_period_months) AS due_at
			FROM order_lines l JOIN orders o ON o.id = l.order_id
			WHERE o.status = 'GIVEN'
			ORDER BY o.employee_id, l.catalogue_item_id, o.given_at DESC, l.line_no
		), due AS (
			SELECT d.* FROM latest d JOIN employees e ON e.id = d.employee_id AND e.deleted_at IS NULL
			WHERE d.due_at < $1 AND NOT EXISTS (
				SELECT 1 FROM orders p JOIN order_lines pl ON pl.order_id = p.id
				WHERE p.status = 'ORDERED' AND p.employee_id = d.employee_id AND pl.catalogue_item_id = d.catalogue_item_id)
		)
		SELECT d.catalogue_item_id,
			coalesce(CASE WHEN c.deleted_at IS NULL THEN c.name END, (array_agg(d.item_name ORDER BY d.given_at DESC))[1]),
			sum(d.quantity), count(DISTINCT d.employee_id),
			CASE WHEN c.deleted_at IS NULL AND c.active AND c.service_period_months IS NOT NULL THEN c.unit_price_cents END,
			coalesce(sum(d.quantity) FILTER (WHERE d.due_at <= $2), 0)
		FROM due d LEFT JOIN catalogue_items c ON c.id = d.catalogue_item_id
		GROUP BY d.catalogue_item_id, c.name, c.deleted_at, c.active, c.service_period_months, c.unit_price_cents
		ORDER BY 3 DESC, 2`, w.ForecastBy, w.Now)
	if err != nil {
		return err
	}
	f.Forecast.Lines, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (ForecastLine, error) {
		var x ForecastLine
		err := row.Scan(&x.CatalogueItemID, &x.ItemName, &x.Quantity, &x.Employees, &x.UnitPriceCents, &x.Overdue)
		return x, err
	})
	return err
}

// readPriceChanges reads the catalogue.price_changed audit events since
// w.PriceChangesSince, newest first.
func readPriceChanges(ctx context.Context, tx pgx.Tx, w ManagerWindow, f *ManagerFigures) error {
	rows, err := tx.Query(ctx, `SELECT a.entity_id, c.name, a.occurred_at, u.name,
			(a.before ->> 'unit_price_cents')::bigint, (a.after ->> 'unit_price_cents')::bigint,
			(a.before ->> 'service_period_months')::int, (a.after ->> 'service_period_months')::int
		FROM audit_events a
			JOIN catalogue_items c ON c.id = a.entity_id
			LEFT JOIN users u ON u.id = a.actor_user_id
		WHERE a.event = $1 AND a.occurred_at >= $2
		ORDER BY a.occurred_at DESC, a.id LIMIT $3`, catalogue.EventPriceChanged, w.PriceChangesSince, w.Limit)
	if err != nil {
		return err
	}
	f.PriceChanges, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (PriceChange, error) {
		var x PriceChange
		err := row.Scan(&x.CatalogueItemID, &x.ItemName, &x.At, &x.ByName, &x.BeforeCents, &x.AfterCents,
			&x.BeforeServiceMonths, &x.AfterServiceMonths)
		x.At = x.At.UTC()
		return x, err
	})
	return err
}

func readCatalogueCheck(ctx context.Context, tx pgx.Tx, w ManagerWindow, f *ManagerFigures) error {
	c := &f.Catalogue
	if err := tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE active), count(*) FILTER (WHERE NOT active)
		FROM catalogue_items WHERE deleted_at IS NULL`).Scan(&c.Active, &c.Inactive); err != nil {
		return err
	}
	refs := func(sql string, args ...any) ([]ItemRef, error) {
		rows, err := tx.Query(ctx, sql, args...)
		if err != nil {
			return nil, err
		}
		return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ItemRef, error) {
			var x ItemRef
			err := row.Scan(&x.ID, &x.Name)
			return x, err
		})
	}
	var err error
	c.Unpriced, err = refs(`SELECT id, name FROM catalogue_items
		WHERE deleted_at IS NULL AND active AND (unit_price_cents IS NULL OR service_period_months IS NULL)
		ORDER BY display_rank, lower(name)`)
	if err != nil {
		return err
	}
	c.NotOrdered, err = refs(`SELECT c.id, c.name FROM catalogue_items c
		WHERE c.deleted_at IS NULL AND c.active AND c.unit_price_cents IS NOT NULL AND c.service_period_months IS NOT NULL
			AND NOT EXISTS (SELECT 1 FROM order_lines l JOIN orders o ON o.id = l.order_id
				WHERE l.catalogue_item_id = c.id AND o.ordered_at >= $1)
		ORDER BY c.display_rank, lower(c.name)`, w.MonthStarts[0])
	return err
}

// readItemSetIssues finds active sets with a line that Apply Item Set would flag.
func readItemSetIssues(ctx context.Context, tx pgx.Tx, _ ManagerWindow, f *ManagerFigures) error {
	rows, err := tx.Query(ctx, `SELECT s.id, s.name,
			count(*) FILTER (WHERE c.deleted_at IS NOT NULL OR NOT c.active),
			count(*) FILTER (WHERE c.deleted_at IS NULL AND c.active AND (c.unit_price_cents IS NULL OR c.service_period_months IS NULL))
		FROM item_sets s
			JOIN item_set_lines l ON l.item_set_id = s.id
			JOIN catalogue_items c ON c.id = l.catalogue_item_id
		WHERE s.deleted_at IS NULL AND s.active
		GROUP BY s.id, s.name
		HAVING count(*) FILTER (WHERE c.deleted_at IS NOT NULL OR NOT c.active
			OR c.unit_price_cents IS NULL OR c.service_period_months IS NULL) > 0
		ORDER BY lower(s.name)`)
	if err != nil {
		return err
	}
	f.ItemSets, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (ItemSetIssue, error) {
		var x ItemSetIssue
		err := row.Scan(&x.ID, &x.Name, &x.Inactive, &x.Unpriced)
		return x, err
	})
	return err
}

func readSizeGroups(ctx context.Context, tx pgx.Tx, _ ManagerWindow, f *ManagerFigures) error {
	rows, err := tx.Query(ctx, `SELECT clothing_size, height_cm, shoe_size, count(*)
		FROM employees WHERE deleted_at IS NULL GROUP BY 1, 2, 3`)
	if err != nil {
		return err
	}
	f.SizeGroups, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (EmployeeSizes, error) {
		var x EmployeeSizes
		err := row.Scan(&x.ClothingSize, &x.HeightCm, &x.ShoeSize, &x.Employees)
		return x, err
	})
	return err
}

// ReadEmployee runs the order preparer's queries in one read-only REPEATABLE READ transaction.
func (r *PostgresRepository) ReadEmployee(ctx context.Context, w EmployeeWindow) (EmployeeOverview, error) {
	var o EmployeeOverview
	err := pgx.BeginTxFunc(ctx, r.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		for _, read := range []func(context.Context, pgx.Tx, EmployeeWindow, *EmployeeOverview) error{
			readMyAwaiting, readMyMonths, readRecentlyGiven, readMissingSizes,
		} {
			if err := read(ctx, tx, w, &o); err != nil {
				return err
			}
		}
		var err error
		o.Replacements, err = queryReplacements(ctx, tx, w.Now, w.DueBy, w.Limit)
		return err
	})
	return o, err
}

// readMyAwaiting reads the user's ORDERED orders with the state of each one's
// latest electronic confirmation link.
func readMyAwaiting(ctx context.Context, tx pgx.Tx, w EmployeeWindow, o *EmployeeOverview) error {
	rows, err := tx.Query(ctx, `
		WITH mine AS (
			SELECT o.id, o.record_seq, o.employee_id, o.employee_first_name || ' ' || o.employee_last_name AS name, o.ordered_at,
				(SELECT coalesce(sum(l.quantity), 0) FROM order_lines l WHERE l.order_id = o.id) AS items,
				`+lineTotal+` AS cents,
				(SELECT c.expires_at FROM order_confirmations c
					WHERE c.order_id = o.id AND c.method = 'ELECTRONIC' AND c.revoked_at IS NULL AND c.expires_at > $2
					ORDER BY c.created_at DESC LIMIT 1) AS expires_at,
				EXISTS (SELECT 1 FROM order_confirmations c WHERE c.order_id = o.id AND c.method = 'ELECTRONIC') AS linked
			FROM orders o WHERE o.status = 'ORDERED' AND o.prepared_by_user_id = $1
		)
		SELECT id, record_seq, employee_id, name, ordered_at, items, cents,
			CASE WHEN expires_at IS NOT NULL THEN 'ACTIVE' WHEN linked THEN 'EXPIRED' ELSE 'NONE' END, expires_at,
			count(*) OVER (), coalesce(sum(items) OVER (), 0), coalesce(sum(cents) OVER (), 0)::bigint,
			count(*) FILTER (WHERE NOT linked) OVER (), count(*) FILTER (WHERE linked AND expires_at IS NULL) OVER ()
		FROM mine ORDER BY ordered_at, id LIMIT $3`, w.UserID, w.Now, w.Limit)
	if err != nil {
		return err
	}
	a := &o.Awaiting
	a.Longest, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (MyWaiting, error) {
		var x MyWaiting
		err := row.Scan(&x.OrderID, &x.RecordSeq, &x.EmployeeID, &x.EmployeeName, &x.OrderedAt, &x.Items, &x.ValueCents,
			&x.Link, &x.LinkExpiresAt, &a.Orders, &a.Items, &a.ValueCents, &a.NoLink, &a.LinkExpired)
		x.OrderedAt = x.OrderedAt.UTC()
		if x.LinkExpiresAt != nil {
			t := x.LinkExpiresAt.UTC()
			x.LinkExpiresAt = &t
		}
		return x, err
	})
	return err
}

// readMyMonths buckets the user's orders into the window's months: ordered by
// ordered_at, given by given_at. Every month gets a row.
func readMyMonths(ctx context.Context, tx pgx.Tx, w EmployeeWindow, o *EmployeeOverview) error {
	n := len(w.MonthStarts) - 1
	rows, err := tx.Query(ctx, `
		WITH m AS (
			SELECT s, e, i FROM unnest($1::timestamptz[], $2::timestamptz[]) WITH ORDINALITY AS m (s, e, i)
		), t AS (
			SELECT o.ordered_at, o.given_at, (SELECT sum(l.quantity) FROM order_lines l WHERE l.order_id = o.id) AS qty
			FROM orders o
			WHERE o.prepared_by_user_id = $4 AND (o.ordered_at >= $3 OR o.given_at >= $3)
		)
		SELECT
			(SELECT count(*) FROM t WHERE t.ordered_at >= m.s AND t.ordered_at < m.e),
			(SELECT count(*) FROM t WHERE t.given_at >= m.s AND t.given_at < m.e),
			(SELECT coalesce(sum(qty), 0)::bigint FROM t WHERE t.given_at >= m.s AND t.given_at < m.e)
		FROM m ORDER BY m.i`, w.MonthStarts[:n], w.MonthStarts[1:], w.MonthStarts[0], w.UserID)
	if err != nil {
		return err
	}
	o.Months, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (MyMonth, error) {
		var x MyMonth
		err := row.Scan(&x.Ordered, &x.Given, &x.GivenItems)
		return x, err
	})
	return err
}

func readRecentlyGiven(ctx context.Context, tx pgx.Tx, w EmployeeWindow, o *EmployeeOverview) error {
	rows, err := tx.Query(ctx, `SELECT o.id, o.record_seq, o.employee_id, o.employee_first_name || ' ' || o.employee_last_name,
			o.given_at, o.confirmation_method,
			(SELECT coalesce(sum(l.quantity), 0) FROM order_lines l WHERE l.order_id = o.id), `+lineTotal+`
		FROM orders o WHERE o.status = 'GIVEN' AND o.prepared_by_user_id = $1
		ORDER BY o.given_at DESC, o.id LIMIT $2`, w.UserID, w.Limit)
	if err != nil {
		return err
	}
	o.RecentlyGiven, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (GivenOrder, error) {
		var x GivenOrder
		err := row.Scan(&x.OrderID, &x.RecordSeq, &x.EmployeeID, &x.EmployeeName, &x.GivenAt, &x.Method, &x.Items, &x.ValueCents)
		x.GivenAt = x.GivenAt.UTC()
		return x, err
	})
	return err
}

func readMissingSizes(ctx context.Context, tx pgx.Tx, w EmployeeWindow, o *EmployeeOverview) error {
	rows, err := tx.Query(ctx, `SELECT id, first_name || ' ' || last_name, code,
			clothing_size IS NULL AND height_cm IS NULL, shoe_size IS NULL, count(*) OVER ()
		FROM employees
		WHERE deleted_at IS NULL AND (shoe_size IS NULL OR (clothing_size IS NULL AND height_cm IS NULL))
		ORDER BY lower(last_name), lower(first_name), id LIMIT $1`, w.Limit)
	if err != nil {
		return err
	}
	m := &o.MissingSizes
	m.List, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (EmployeeMissingSize, error) {
		var x EmployeeMissingSize
		err := row.Scan(&x.EmployeeID, &x.EmployeeName, &x.EmployeeCode, &x.Clothing, &x.Shoes, &m.Employees)
		return x, err
	})
	return err
}
