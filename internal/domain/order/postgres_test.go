package order

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type pgFixture struct {
	pool                 *pgxpool.Pool
	svc                  *Service
	actor, emp           uuid.UUID
	shoes, gloves, draft uuid.UUID
}

// newPGFixture empties the database and seeds an actor, an employee and items.
func newPGFixture(t *testing.T) pgFixture {
	t.Helper()
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
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
	f := pgFixture{pool: pool, actor: uuid.New(), emp: uuid.New(), shoes: uuid.New(), gloves: uuid.New(), draft: uuid.New()}
	exec(`INSERT INTO users (id, email, name, password_hash, roles, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'a@example.com', 'Admin', 'x', '{admin}', now(), now(), $1, $1)`, f.actor)
	exec(`INSERT INTO employees (id, first_name, last_name, code, shoe_size, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'Jonas', 'Petraitis', 'W-17', '43', now(), now(), $2, $2)`, f.emp, f.actor)
	item := func(id uuid.UUID, name, group string, cents *int64, months *int) {
		exec(`INSERT INTO catalogue_items (id, name, details, size_group, unit_price_cents, service_period_months,
			created_at, updated_at, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, 'model', $3, $4, $5, now(), now(), $6, $6)`, id, name, group, cents, months, f.actor)
	}
	item(f.shoes, "Safety shoes", "SHOES", i64(4999), ip(12))
	item(f.gloves, "Protective gloves", "NONE", i64(250), ip(1))
	item(f.draft, "Helmet", "NONE", nil, ip(24))
	f.svc = NewService(NewPostgresRepository(pool), Readers{})
	return f
}

func TestPostgresMarkAsOrdered(t *testing.T) {
	f := newPGFixture(t)
	ctx := context.Background()

	o, err := f.svc.MarkAsOrdered(ctx, MarkAsOrderedParams{f.emp, []LineParams{{f.shoes, 1, sp("43")}, {f.gloves, 5, nil}}}, f.actor)
	if err != nil {
		t.Fatal(err)
	}
	got, err := f.svc.Get(ctx, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusOrdered || got.RecordSeq != o.RecordSeq || got.PreparedByName != "Admin" || *got.EmployeeCode != "W-17" ||
		len(got.Lines) != 2 || *got.Lines[0].Size != "43" || got.Lines[1].Size != nil || got.Lines[1].Quantity != 5 || got.TotalCents() != 4999+1250 {
		t.Fatalf("stored = %+v", got)
	}

	// Later catalogue and employee edits leave the record alone.
	if _, err := f.pool.Exec(ctx, `UPDATE catalogue_items SET unit_price_cents = 9999, name = 'Renamed' WHERE id = $1`, f.shoes); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE employees SET first_name = 'Changed' WHERE id = $1`, f.emp); err != nil {
		t.Fatal(err)
	}
	got, _ = f.svc.Get(ctx, o.ID)
	if got.Lines[0].UnitPriceCents != 4999 || got.Lines[0].ItemName != "Safety shoes" || got.EmployeeFirstName != "Jonas" {
		t.Errorf("snapshot followed live data: %+v", got)
	}

	// Snapshot lines are immutable in the database.
	if _, err := f.pool.Exec(ctx, `UPDATE order_lines SET quantity = 99 WHERE order_id = $1`, o.ID); err == nil {
		t.Error("order_lines UPDATE succeeded")
	}
	var events int
	f.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id = $1 AND event = $2`, o.ID, EventOrdered).Scan(&events)
	if events != 1 {
		t.Errorf("order.ordered events = %d", events)
	}

	// Record numbers increase.
	o2, err := f.svc.MarkAsOrdered(ctx, MarkAsOrderedParams{f.emp, []LineParams{{f.gloves, 1, nil}}}, f.actor)
	if err != nil || o2.RecordSeq <= o.RecordSeq {
		t.Errorf("second order seq %d after %d: %v", o2.RecordSeq, o.RecordSeq, err)
	}
}

func TestPostgresMarkAsOrderedRollsBack(t *testing.T) {
	f := newPGFixture(t)
	ctx := context.Background()
	cases := map[string]struct {
		p    MarkAsOrderedParams
		want error
	}{
		"price missing":    {MarkAsOrderedParams{f.emp, []LineParams{{f.gloves, 1, nil}, {f.draft, 1, nil}}}, ErrPriceMissing},
		"missing size":     {MarkAsOrderedParams{f.emp, []LineParams{{f.shoes, 1, nil}}}, ErrInvalid},
		"unknown employee": {MarkAsOrderedParams{uuid.New(), []LineParams{{f.gloves, 1, nil}}}, ErrEmployeeNotFound},
	}
	for name, c := range cases {
		if _, err := f.svc.MarkAsOrdered(ctx, c.p, f.actor); !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", name, err, c.want)
		}
	}
	if _, err := f.pool.Exec(ctx, `UPDATE catalogue_items SET active = false WHERE id = $1`, f.gloves); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.MarkAsOrdered(ctx, MarkAsOrderedParams{f.emp, []LineParams{{f.gloves, 1, nil}}}, f.actor); !errors.Is(err, ErrItemUnavailable) {
		t.Errorf("inactive err = %v", err)
	}
	var orders, lines, events int
	f.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM orders), (SELECT count(*) FROM order_lines),
		(SELECT count(*) FROM audit_events WHERE event = $1)`, EventOrdered).Scan(&orders, &lines, &events)
	if orders+lines+events != 0 {
		t.Errorf("rejected orders left rows: %d orders, %d lines, %d events", orders, lines, events)
	}
}

// TestPostgresConcurrentOrdersGetDistinctNumbers runs Mark as Ordered in
// parallel: every order commits with its own record number.
func TestPostgresConcurrentOrdersGetDistinctNumbers(t *testing.T) {
	f := newPGFixture(t)
	const n = 8
	var wg sync.WaitGroup
	seqs := make(chan int64, n)
	for range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			o, err := f.svc.MarkAsOrdered(context.Background(), MarkAsOrderedParams{f.emp, []LineParams{{f.gloves, 1, nil}}}, f.actor)
			if err != nil {
				t.Error(err)
				return
			}
			seqs <- o.RecordSeq
		}()
	}
	wg.Wait()
	close(seqs)
	seen := map[int64]bool{}
	for s := range seqs {
		if seen[s] {
			t.Errorf("duplicate record number %d", s)
		}
		seen[s] = true
	}
	if len(seen) != n {
		t.Errorf("%d orders committed, want %d", len(seen), n)
	}
}

// TestPostgresHistory checks History ordering, filters and paging on stored
// orders, with activity times set directly.
func TestPostgresHistory(t *testing.T) {
	f := newPGFixture(t)
	ctx := context.Background()
	loc, err := time.LoadLocation("Europe/Vilnius")
	if err != nil {
		t.Fatal(err)
	}
	f.svc = NewService(NewPostgresRepository(f.pool), Readers{}, WithLocation(loc))

	other := uuid.New()
	if _, err := f.pool.Exec(ctx, `INSERT INTO employees (id, first_name, last_name, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'Ona', 'K', now(), now(), $2, $2)`, other, f.actor); err != nil {
		t.Fatal(err)
	}
	mark := func(emp uuid.UUID, orderedAt time.Time, givenAt *time.Time, qty int) Order {
		t.Helper()
		o, err := f.svc.MarkAsOrdered(ctx, MarkAsOrderedParams{emp, []LineParams{{f.gloves, qty, nil}}}, f.actor)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(ctx, `UPDATE orders SET ordered_at = $2 WHERE id = $1`, o.ID, orderedAt); err != nil {
			t.Fatal(err)
		}
		if givenAt != nil {
			if _, err := f.pool.Exec(ctx, `UPDATE orders SET status = 'GIVEN', given_at = $2, given_by_user_id = $3,
				given_by_name = 'Admin', confirmation_method = 'PAPER' WHERE id = $1`, o.ID, *givenAt, f.actor); err != nil {
				t.Fatal(err)
			}
		}
		return o
	}
	utc := func(d, h int) time.Time { return time.Date(2026, 9, d, h, 0, 0, 0, time.UTC) }
	g := utc(23, 22)                     // 01:00 on the 24th in Vilnius
	a := mark(f.emp, utc(20, 9), nil, 2) // activity 20th
	b := mark(f.emp, utc(21, 9), &g, 2)  // activity 23rd 22:00 UTC = 24th Vilnius
	c := mark(other, utc(22, 9), nil, 5) // activity 22nd; the largest total

	ids := func(res ListResult) []uuid.UUID {
		out := make([]uuid.UUID, len(res.Orders))
		for i, o := range res.Orders {
			out[i] = o.ID
		}
		return out
	}
	same := func(got []uuid.UUID, want ...uuid.UUID) bool {
		if len(got) != len(want) {
			return false
		}
		for i := range got {
			if got[i] != want[i] {
				return false
			}
		}
		return true
	}

	all, err := f.svc.List(ctx, ListParams{})
	if err != nil {
		t.Fatal(err)
	}
	if !same(ids(all), b.ID, c.ID, a.ID) || all.Total != 3 || len(all.Orders[0].Lines) != 1 {
		t.Errorf("newest activity first: %+v", ids(all))
	}
	if all.Orders[0].UsageMonths == nil || all.Orders[1].UsageMonths != nil {
		t.Errorf("usage months only on GIVEN")
	}

	emp := f.emp
	byEmp, _ := f.svc.List(ctx, ListParams{EmployeeID: &emp})
	if !same(ids(byEmp), b.ID, a.ID) {
		t.Errorf("employee filter = %v", ids(byEmp))
	}
	given, _ := f.svc.List(ctx, ListParams{Status: "GIVEN"})
	if !same(ids(given), b.ID) {
		t.Errorf("status filter = %v", ids(given))
	}
	// The GIVEN order's activity is the 24th in Vilnius although it is the 23rd in UTC.
	day, _ := f.svc.List(ctx, ListParams{FromDate: "2026-09-24", ToDate: "2026-09-24"})
	if !same(ids(day), b.ID) {
		t.Errorf("Vilnius date filter = %v", ids(day))
	}
	rng, _ := f.svc.List(ctx, ListParams{FromDate: "2026-09-20", ToDate: "2026-09-22"})
	if !same(ids(rng), c.ID, a.ID) {
		t.Errorf("date range = %v", ids(rng))
	}
	p2, _ := f.svc.List(ctx, ListParams{Page: 2, PageSize: 2})
	if !same(ids(p2), a.ID) || p2.Total != 3 {
		t.Errorf("page 2 = %v total %d", ids(p2), p2.Total)
	}

	// Sorting: a, b and c were created in that order, so their record numbers
	// ascend. Ties fall back to newest activity first.
	for _, tc := range []struct {
		sort, dir string
		want      []uuid.UUID
	}{
		{"record", "asc", []uuid.UUID{a.ID, b.ID, c.ID}},
		{"record", "desc", []uuid.UUID{c.ID, b.ID, a.ID}},
		{"date", "asc", []uuid.UUID{a.ID, c.ID, b.ID}},
		{"status", "asc", []uuid.UUID{b.ID, c.ID, a.ID}}, // GIVEN before ORDERED, then newest activity
		{"total", "desc", []uuid.UUID{c.ID, b.ID, a.ID}}, // c has 5 gloves; a and b tie, newest activity first
		{"total", "asc", []uuid.UUID{b.ID, a.ID, c.ID}},
		// Only b is GIVEN; the ORDERED orders have no usage time and stay last in both directions.
		{"usage", "asc", []uuid.UUID{b.ID, c.ID, a.ID}},
		{"usage", "desc", []uuid.UUID{b.ID, c.ID, a.ID}},
	} {
		res, err := f.svc.List(ctx, ListParams{Sort: tc.sort, Dir: tc.dir})
		if err != nil {
			t.Fatal(err)
		}
		if !same(ids(res), tc.want...) {
			t.Errorf("sort %s %s = %v, want %v", tc.sort, tc.dir, ids(res), tc.want)
		}
	}
	names := map[string][]uuid.UUID{}
	for _, dir := range []string{"asc", "desc"} {
		res, _ := f.svc.List(ctx, ListParams{Sort: "employee", Dir: dir})
		names[dir] = ids(res)
	}
	// Ona K has one order (c); the fixture employee has a and b. Whichever name sorts
	// first, c is at one end and flips to the other when the direction flips.
	if (names["asc"][0] == c.ID) == (names["desc"][0] == c.ID) {
		t.Errorf("employee sort does not flip: asc %v desc %v", names["asc"], names["desc"])
	}
}

func TestPostgresConfirmation(t *testing.T) {
	f := newPGFixture(t)
	ctx := context.Background()
	o, err := f.svc.MarkAsOrdered(ctx, MarkAsOrderedParams{f.emp, []LineParams{{f.shoes, 1, sp("43")}}}, f.actor)
	if err != nil {
		t.Fatal(err)
	}
	old, _, _ := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor)
	token, _, err := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor)
	if err != nil {
		t.Fatal(err)
	}
	var plaintext int
	f.pool.QueryRow(ctx, `SELECT count(*) FROM order_confirmations WHERE token_hash = $1`, token).Scan(&plaintext)
	if plaintext != 0 {
		t.Fatal("token stored in plaintext")
	}
	if _, err := f.svc.ConfirmByToken(ctx, old, true); !errors.Is(err, ErrLinkExpired) {
		t.Errorf("replaced link err = %v", err)
	}

	// Two confirmations race; exactly one writes, both see GIVEN.
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := f.svc.ConfirmByToken(ctx, token, true)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent confirm: %v", err)
		}
	}

	rec, err := f.svc.Record(ctx, o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Order.Status != StatusGiven || rec.Confirmation == nil || rec.DocumentHash != DocumentHash(ReceiptOf(rec.Order)) {
		t.Fatalf("record = %+v", rec)
	}
	var confirmed, given int
	f.pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM order_confirmations WHERE order_id = $1 AND confirmed_at IS NOT NULL),
		(SELECT count(*) FROM audit_events WHERE entity_id = $1 AND event = $2)`, o.ID, EventGiven).Scan(&confirmed, &given)
	if confirmed != 1 || given != 1 {
		t.Errorf("confirmed rows %d, given events %d; want 1 and 1", confirmed, given)
	}
	var actor *uuid.UUID
	f.pool.QueryRow(ctx, `SELECT actor_user_id FROM audit_events WHERE entity_id = $1 AND event = $2`, o.ID, EventGiven).Scan(&actor)
	if actor != nil {
		t.Errorf("public confirmation attributed to %v", *actor)
	}

	// Paper on an already GIVEN order is a no-op.
	p, err := f.svc.ConfirmPaper(ctx, o.ID, f.actor)
	if err != nil || *p.Order.ConfirmationMethod != MethodElectronic {
		t.Errorf("paper after electronic = %+v, %v", p.Order, err)
	}
}

func TestPostgresPaperConfirmation(t *testing.T) {
	f := newPGFixture(t)
	ctx := context.Background()
	o, err := f.svc.MarkAsOrdered(ctx, MarkAsOrderedParams{f.emp, []LineParams{{f.gloves, 4, nil}}}, f.actor)
	if err != nil {
		t.Fatal(err)
	}
	link, _, _ := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor)
	rec, err := f.svc.ConfirmPaper(ctx, o.ID, f.actor)
	if err != nil {
		t.Fatal(err)
	}
	if *rec.Order.GivenByName != "Admin" || rec.Confirmation.Method != MethodPaper || *rec.Confirmation.ConfirmedName != "Jonas Petraitis" {
		t.Errorf("paper = %+v %+v", rec.Order, rec.Confirmation)
	}
	var revoked int
	f.pool.QueryRow(ctx, `SELECT count(*) FROM order_confirmations WHERE order_id = $1 AND method = 'ELECTRONIC' AND revoked_at IS NOT NULL`, o.ID).Scan(&revoked)
	if revoked != 1 {
		t.Errorf("outstanding link not revoked")
	}
	if view, err := f.svc.RecordByToken(ctx, link); err != nil || view.Order.Status != StatusGiven {
		t.Errorf("link after paper = %v", err)
	}
	// History now shows usage time for it.
	res, _ := f.svc.List(ctx, ListParams{Status: "GIVEN"})
	if len(res.Orders) != 1 || res.Orders[0].UsageMonths == nil || *res.Orders[0].UsageMonths != 0 {
		t.Errorf("history GIVEN = %+v", res.Orders)
	}
}

// TestPostgresStatusInvariants checks the database enforces the two-status
// model even against direct SQL: no other status, GIVEN fields only with
// GIVEN, and no way back from GIVEN through the repository.
func TestPostgresStatusInvariants(t *testing.T) {
	f := newPGFixture(t)
	ctx := context.Background()
	o, err := f.svc.MarkAsOrdered(ctx, MarkAsOrderedParams{f.emp, []LineParams{{f.gloves, 1, nil}}}, f.actor)
	if err != nil {
		t.Fatal(err)
	}
	for name, sql := range map[string]string{
		"draft status":              `UPDATE orders SET status = 'DRAFT' WHERE id = $1`,
		"partially given":           `UPDATE orders SET status = 'PARTIALLY_GIVEN' WHERE id = $1`,
		"GIVEN without evidence":    `UPDATE orders SET status = 'GIVEN' WHERE id = $1`,
		"given_at on ORDERED":       `UPDATE orders SET given_at = now() WHERE id = $1`,
		"size on no-size line":      `INSERT INTO order_lines (id, order_id, line_no, catalogue_item_id, item_name, item_details, size_group, size, quantity, unit_price_cents, currency, service_period_months) SELECT gen_random_uuid(), $1, 9, catalogue_item_id, 'x', '', 'NONE', 'M', 1, 1, 'EUR', 1 FROM order_lines WHERE order_id = $1 LIMIT 1`,
		"quantity zero line":        `INSERT INTO order_lines (id, order_id, line_no, catalogue_item_id, item_name, item_details, size_group, size, quantity, unit_price_cents, currency, service_period_months) SELECT gen_random_uuid(), $1, 9, gen_random_uuid(), 'x', '', 'NONE', NULL, 0, 1, 'EUR', 1`,
		"delete snapshot line":      `DELETE FROM order_lines WHERE order_id = $1`,
		"second confirmed evidence": `INSERT INTO order_confirmations (id, order_id, method, confirmed_at, confirmed_name, document_hash, created_at, created_by_user_id) SELECT gen_random_uuid(), $1, 'PAPER', now(), 'x', 'h', now(), prepared_by_user_id FROM orders WHERE id = $1 UNION ALL SELECT gen_random_uuid(), $1, 'PAPER', now(), 'y', 'h', now(), prepared_by_user_id FROM orders WHERE id = $1`,
	} {
		if _, err := f.pool.Exec(ctx, sql, o.ID); err == nil {
			t.Errorf("%s: database accepted it", name)
		}
	}

	// The only transition: ORDERED → GIVEN, once.
	if _, err := f.svc.ConfirmPaper(ctx, o.ID, f.actor); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor); !errors.Is(err, ErrNotOrdered) {
		t.Errorf("link after GIVEN err = %v", err)
	}
	// The repository's GIVEN update is guarded on status = 'ORDERED'.
	_, err = NewPostgresRepository(f.pool).Confirm(ctx, o.ID, nil, f.actor, func(s ConfirmSnapshot) (ConfirmResult, error) {
		now := time.Now().UTC()
		m := MethodPaper
		o := s.Order
		o.Status, o.GivenAt, o.GivenByUserID, o.GivenByName, o.ConfirmationMethod = StatusGiven, &now, &f.actor, sp("x"), &m
		return ConfirmResult{Order: o, Confirmation: Confirmation{ID: uuid.New(), OrderID: o.ID, Method: MethodPaper, CreatedAt: now, CreatedByUserID: f.actor, ConfirmedAt: &now, ConfirmedName: sp("x"), DocumentHash: sp("h")}, IsNew: true}, nil
	})
	if !errors.Is(err, ErrNotOrdered) {
		t.Errorf("re-giving a GIVEN order err = %v, want ErrNotOrdered", err)
	}
}
