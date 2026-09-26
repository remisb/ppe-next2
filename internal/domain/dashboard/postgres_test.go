package dashboard

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pgData is the fixture shared by the dashboard tests.
type pgData struct {
	pool                 *pgxpool.Pool
	now                  time.Time
	admin                uuid.UUID
	ona, jonas           uuid.UUID
	shoes, gloves, draft uuid.UUID
	o1, waitOld          uuid.UUID
}

// seedPG empties the database and seeds orders directly, as the order
// service would have stored them, around a fixed "now" of 15 September 2026.
func seedPG(t *testing.T) pgData {
	t.Helper()
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`TRUNCATE users CASCADE`)

	now := utc("2026-09-15T10:00:00Z")
	admin, manager := uuid.New(), uuid.New()
	exec(`INSERT INTO users (id, email, name, password_hash, roles, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'a@example.com', 'Admin', 'x', '{admin}', now(), now(), $1, $1),
		       ($2, 'm@example.com', 'Manager', 'x', '{manager}', now(), now(), $1, $1)`, admin, manager)

	ona, jonas, gone := uuid.New(), uuid.New(), uuid.New()
	// Ona has every size; Jonas has no shoe size; gone is deleted.
	exec(`INSERT INTO employees (id, first_name, last_name, code, clothing_size, shoe_size, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'Ona', 'Kazlauskienė', 'W-1', 'M', '39', now(), now(), $2, $2)`, ona, admin)
	exec(`INSERT INTO employees (id, first_name, last_name, height_cm, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'Jonas', 'Petraitis', 180, now(), now(), $2, $2)`, jonas, admin)
	exec(`INSERT INTO employees (id, first_name, last_name, clothing_size, shoe_size, created_at, updated_at, deleted_at,
			created_by_user_id, updated_by_user_id, deleted_by_user_id)
		VALUES ($1, 'Gone', 'Away', 'L', '44', now(), now(), now(), $2, $2, $2)`, gone, admin)

	shoes, gloves, draft := uuid.New(), uuid.New(), uuid.New()
	exec(`INSERT INTO catalogue_items (id, name, size_group, unit_price_cents, service_period_months, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'Safety shoes', 'SHOES', 5000, 12, now(), now(), $4, $4),
		       ($2, 'Gloves', 'NONE', 200, 1, now(), now(), $4, $4),
		       ($3, 'Helmet', 'NONE', NULL, 24, now(), now(), $4, $4)`, shoes, gloves, draft, admin)
	exec(`INSERT INTO item_sets (id, name, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'Starter', now(), now(), $2, $2)`, uuid.New(), admin)

	seq := int64(0)
	type line struct {
		item      uuid.UUID
		name      string
		size      *string
		qty       int
		cents     int64
		months    int
		sizeGroup string
	}
	shoeLine := func(qty int) line { s := "39"; return line{shoes, "Safety shoes", &s, qty, 5000, 12, "SHOES"} }
	gloveLine := func(qty int) line { return line{gloves, "Gloves", nil, qty, 200, 1, "NONE"} }
	order := func(emp uuid.UUID, first string, orderedAt time.Time, givenAt *time.Time, method string, lines ...line) uuid.UUID {
		t.Helper()
		id := uuid.New()
		seq++
		if givenAt == nil {
			exec(`INSERT INTO orders (id, record_seq, employee_id, employee_first_name, employee_last_name, status, ordered_at,
					prepared_by_user_id, prepared_by_name, updated_at)
				VALUES ($1, $2, $3, $4, 'X', 'ORDERED', $5, $6, 'Admin', $5)`, id, seq, emp, first, orderedAt, admin)
		} else {
			exec(`INSERT INTO orders (id, record_seq, employee_id, employee_first_name, employee_last_name, status, ordered_at,
					prepared_by_user_id, prepared_by_name, given_at, given_by_user_id, given_by_name, confirmation_method, updated_at)
				VALUES ($1, $2, $3, $4, 'X', 'GIVEN', $5, $6, 'Admin', $7, $6, 'Admin', $8, $7)`, id, seq, emp, first, orderedAt, admin, *givenAt, method)
		}
		for i, l := range lines {
			exec(`INSERT INTO order_lines (id, order_id, line_no, catalogue_item_id, item_name, item_details, size_group, size, quantity,
					unit_price_cents, currency, service_period_months)
				VALUES ($1, $2, $3, $4, $5, '', $6, $7, $8, $9, 'EUR', $10)`, uuid.New(), id, i+1, l.item, l.name, l.sizeGroup, l.size, l.qty, l.cents, l.months)
		}
		return id
	}
	at := func(s string) *time.Time { u := utc(s); return &u }

	// 1. Ona, a year ago: shoes given 2025-09-20, due 2026-09-20 (due soon).
	o1 := order(ona, "Ona", utc("2025-09-18T08:00:00Z"), at("2025-09-20T08:00:00Z"), "PAPER", shoeLine(1))
	// 2. Ona: gloves ordered in August, given 1 September (two days later), due 1 October; not a
	// replacement, because the order waiting since 14 September holds gloves for her.
	order(ona, "Ona", utc("2026-08-30T08:00:00Z"), at("2026-09-01T08:00:00Z"), "ELECTRONIC", gloveLine(10))
	// 3. Jonas: gloves given in July, overdue since August; the one line of a deleted employee's order does not count.
	order(jonas, "Jonas", utc("2026-07-01T08:00:00Z"), at("2026-07-02T08:00:00Z"), "ELECTRONIC", gloveLine(4))
	order(gone, "Gone", utc("2026-07-01T08:00:00Z"), at("2026-07-02T08:00:00Z"), "PAPER", gloveLine(1))
	// 4. Jonas: shoes given long ago and already reordered: not a replacement, but waiting.
	order(jonas, "Jonas", utc("2024-01-10T08:00:00Z"), at("2024-01-12T08:00:00Z"), "PAPER", shoeLine(1))
	waitOld := order(jonas, "Jonas", utc("2026-09-10T08:00:00Z"), nil, "", shoeLine(1))
	order(ona, "Ona", utc("2026-09-14T08:00:00Z"), nil, "", gloveLine(5))

	return pgData{pool: pool, now: now, admin: admin, ona: ona, jonas: jonas, shoes: shoes, gloves: gloves, draft: draft, o1: o1, waitOld: waitOld}
}

// TestPostgresOverview checks every administrator figure against the fixture.
func TestPostgresOverview(t *testing.T) {
	d := seedPG(t)
	ctx := context.Background()
	pool, now, jonas, gloves, o1, waitOld := d.pool, d.now, d.jonas, d.gloves, d.o1, d.waitOld
	svc := NewService(NewPostgresRepository(pool), WithClock(func() time.Time { return now }))
	o, err := svc.Overview(ctx)
	if err != nil {
		t.Fatal(err)
	}

	a := o.Awaiting
	if a.Orders != 2 || a.ValueCents != 5000+1000 || len(a.Longest) != 2 || a.Longest[0].OrderID != waitOld ||
		a.Longest[0].Days != 5 || a.Longest[0].EmployeeName != "Jonas X" || a.Longest[0].ValueCents != 5000 || *a.OldestDays != 5 {
		t.Errorf("awaiting = %+v", a)
	}

	if len(o.Months) != Months {
		t.Fatalf("months = %d", len(o.Months))
	}
	sep, aug, jul, first := o.Months[11], o.Months[10], o.Months[9], o.Months[0]
	if sep.Month != "2026-09" || sep.OrderedOrders != 2 || sep.OrderedCents != 6000 || sep.GivenOrders != 1 || sep.GivenItems != 10 || sep.GivenCents != 2000 {
		t.Errorf("September = %+v", sep)
	}
	if aug.OrderedOrders != 1 || aug.OrderedCents != 2000 || aug.GivenOrders != 0 {
		t.Errorf("August = %+v", aug)
	}
	if jul.GivenOrders != 2 || jul.GivenItems != 5 || jul.GivenCents != 1000 {
		t.Errorf("July = %+v", jul)
	}
	// The window starts on 1 October 2025: order 1 (September 2025) is outside it.
	if first.Month != "2025-10" || first.OrderedOrders != 0 || first.GivenOrders != 0 {
		t.Errorf("first month = %+v", first)
	}

	// Given in the last 90 days: orders 2 and both July ones; each took 1 or 2 days.
	c := o.Confirmation
	if c.Given != 3 || c.Electronic != 2 || c.Paper != 1 || c.MedianDays == nil || *c.MedianDays != 1 {
		t.Errorf("confirmation = %+v (median %v)", c, c.MedianDays)
	}

	// Given since 1 October 2025: gloves 10 + 4 + 1.
	if len(o.TopItems) != 1 || o.TopItems[0].CatalogueItemID != gloves || o.TopItems[0].Quantity != 15 || o.TopItems[0].ValueCents != 3000 {
		t.Errorf("top items = %+v", o.TopItems)
	}

	r := o.Replacements
	if r.Overdue != 1 || r.DueSoon != 1 || len(r.Next) != 2 {
		t.Fatalf("replacements = %+v", r)
	}
	if n := r.Next[0]; n.EmployeeID != jonas || n.CatalogueItemID != gloves || !n.Overdue || !n.DueAt.Equal(utc("2026-08-02T08:00:00Z")) {
		t.Errorf("first replacement = %+v", n)
	}
	if n := r.Next[1]; n.OrderID != o1 || *n.Size != "39" || n.Overdue || n.EmployeeCode == nil || *n.EmployeeCode != "W-1" || n.RecordNumber != "WE-000001" {
		t.Errorf("last replacement = %+v", n)
	}

	s := o.Setup
	if s.Employees != 2 || s.EmployeesMissingSizes != 1 || s.CatalogueActive != 3 || s.CatalogueUnpriced != 1 ||
		s.ItemSetsActive != 1 || s.Users != 2 || s.Admins != 1 {
		t.Errorf("setup = %+v", s)
	}
}

// TestPostgresManager checks the manager's figures against the same fixture,
// plus a price change, an inactive and an unordered item, and two item sets.
func TestPostgresManager(t *testing.T) {
	d := seedPG(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := d.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	vest, plugs := uuid.New(), uuid.New()
	exec(`INSERT INTO catalogue_items (id, name, size_group, unit_price_cents, service_period_months, active, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'Old vest', 'CLOTHING', 1500, 12, FALSE, now(), now(), $3, $3),
		       ($2, 'Ear plugs', 'NONE', 50, 1, TRUE, now(), now(), $3, $3)`, vest, plugs, d.admin)
	price := func(at string, before, after int64) {
		exec(`INSERT INTO audit_events (id, actor_user_id, event, entity_type, entity_id, occurred_at, before, after)
			VALUES ($1, $2, 'catalogue.price_changed', 'catalogue_item', $3, $4,
				jsonb_build_object('unit_price_cents', $5::bigint, 'currency', 'EUR', 'service_period_months', 12),
				jsonb_build_object('unit_price_cents', $6::bigint, 'currency', 'EUR', 'service_period_months', 18))`,
			uuid.New(), d.admin, d.shoes, utc(at), before, after)
	}
	price("2025-01-01T08:00:00Z", 3500, 4000) // before the twelve months
	price("2026-06-01T08:00:00Z", 4000, 5000)
	starter, clean := uuid.New(), uuid.New()
	exec(`INSERT INTO item_sets (id, name, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'Clean', now(), now(), $2, $2)`, clean, d.admin)
	exec(`INSERT INTO item_set_lines (item_set_id, catalogue_item_id, default_quantity, display_order)
		VALUES ($1, $2, 1, 0)`, clean, d.gloves)
	if err := d.pool.QueryRow(ctx, `SELECT id FROM item_sets WHERE name = 'Starter'`).Scan(&starter); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO item_set_lines (item_set_id, catalogue_item_id, default_quantity, display_order)
		VALUES ($1, $2, 1, 0), ($1, $3, 1, 1), ($1, $4, 1, 2)`, starter, d.shoes, d.draft, vest)

	svc := NewService(NewPostgresRepository(d.pool), WithClock(func() time.Time { return d.now }))
	o, err := svc.Manager(ctx)
	if err != nil {
		t.Fatal(err)
	}

	if o.OnOrder != (OnOrder{Orders: 2, Items: 6, ValueCents: 6000}) {
		t.Errorf("on order = %+v", o.OnOrder)
	}
	if len(o.Months) != Months {
		t.Fatalf("months = %d", len(o.Months))
	}
	sep, aug, jul := o.Months[11], o.Months[10], o.Months[9]
	if sep != (OrderedMonth{Month: "2026-09", Orders: 2, Items: 6, ValueCents: 6000}) ||
		aug != (OrderedMonth{Month: "2026-08", Orders: 1, Items: 10, ValueCents: 2000}) ||
		jul != (OrderedMonth{Month: "2026-07", Orders: 2, Items: 5, ValueCents: 1000}) || o.Months[0].Orders != 0 {
		t.Errorf("months = %+v", o.Months)
	}
	// Since 1 October 2025: shoes 1 × €50 (the September 2025 pair is older), gloves 20 × €2.
	if s := o.SpendByItem; len(s) != 2 || s[0].CatalogueItemID != d.shoes || s[0].ValueCents != 5000 || s[1].Quantity != 20 || s[1].ValueCents != 4000 {
		t.Errorf("spend by item = %+v", s)
	}

	// Due by 14 December: Jonas's gloves (overdue) and Ona's shoes. Ona's gloves
	// and Jonas's shoes are on order again; Gone is deleted.
	f := o.Forecast
	if f.Items != 5 || f.EstimatedCents != 4*200+5000 || f.Unpriced != 0 || len(f.Lines) != 2 {
		t.Fatalf("forecast = %+v", f)
	}
	if l := f.Lines[0]; l.CatalogueItemID != d.gloves || l.Quantity != 4 || l.Overdue != 4 || l.Employees != 1 || *l.UnitPriceCents != 200 {
		t.Errorf("gloves line = %+v", l)
	}
	if l := f.Lines[1]; l.CatalogueItemID != d.shoes || l.Overdue != 0 || *l.EstimatedCents != 5000 {
		t.Errorf("shoes line = %+v", l)
	}

	if p := o.PriceChanges; len(p) != 1 || p[0].ItemName != "Safety shoes" || *p[0].BeforeCents != 4000 || *p[0].AfterCents != 5000 ||
		*p[0].BeforeServiceMonths != 12 || *p[0].AfterServiceMonths != 18 || *p[0].ByName != "Admin" {
		t.Errorf("price changes = %+v", p)
	}

	c := o.Catalogue
	if c.Active != 4 || c.Inactive != 1 || len(c.Unpriced) != 1 || c.Unpriced[0].ID != d.draft ||
		len(c.NotOrdered) != 1 || c.NotOrdered[0].ID != plugs {
		t.Errorf("catalogue = %+v", c)
	}
	if s := o.ItemSets; len(s) != 1 || s[0].ID != starter || s[0].Inactive != 1 || s[0].Unpriced != 1 {
		t.Errorf("item sets = %+v", s)
	}
	// Ona: M and 39. Jonas: 180 cm suggests a clothing size, no shoe size.
	if s := o.Sizes; s.Suggested != 1 || s.NoClothing != 0 || s.NoShoes != 1 || s.Shoes[0] != (SizeCount{Size: "39", Employees: 1}) {
		t.Errorf("sizes = %+v", s)
	}
}
