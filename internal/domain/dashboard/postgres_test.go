package dashboard

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestPostgresOverview seeds orders directly, as the order service would have
// stored them, and checks every figure against the fixed "now".
func TestPostgresOverview(t *testing.T) {
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
