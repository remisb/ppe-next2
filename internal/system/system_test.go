package system

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Occurrences of one error differ in ids and numbers, never in kind, route
// or the place it panicked.
func TestFingerprint(t *testing.T) {
	base := Report{Kind: KindServer, Route: "GET /api/v1/orders/{id}", Method: "GET",
		Message: "order 6f1c0e4a-91d2-4b3e-8c55-0a3b2c1d4e5f: timeout after 1500ms"}
	same := base
	same.Message = "order 0a0b0c0d-1111-4222-8333-444455556666:  timeout after 2500ms"
	if fingerprint(base) != fingerprint(same) {
		t.Error("ids and numbers changed the fingerprint")
	}
	for name, mutate := range map[string]func(*Report){
		"kind":    func(r *Report) { r.Kind = KindPanic },
		"route":   func(r *Report) { r.Route = "GET /api/v1/employees/{id}" },
		"message": func(r *Report) { r.Message = "order :id: connection refused" },
	} {
		other := base
		mutate(&other)
		if fingerprint(other) == fingerprint(base) {
			t.Errorf("another %s, the same fingerprint", name)
		}
	}
	a, b := base, base
	a.Kind, b.Kind = KindPanic, KindPanic
	a.Stack = "goroutine 7 [running]:\ngithub.com/remisb/ppe-next2/internal/domain/order.(*Service).Get(...)\n"
	b.Stack = "goroutine 9 [running]:\ngithub.com/remisb/ppe-next2/cmd/api.registerOrderRoutes.func1(...)\n"
	if fingerprint(a) == fingerprint(b) || len(fingerprint(a)) != 16 {
		t.Error("panics in two places share a fingerprint")
	}
}

func TestClientRoute(t *testing.T) {
	for in, want := range map[string]string{
		"/orders/6f1c0e4a-91d2-4b3e-8c55-0a3b2c1d4e5f":          "/orders/:id",
		"/admin/audit/6f1c0e4a-91d2-4b3e-8c55-0a3b2c1d4e5f?x=1": "/admin/audit/:id",
		"/employees/12/receipt/WE-000042#top":                   "/employees/:id/receipt/:id",
		"/":                                                     "/",
	} {
		if got := ClientRoute(in); got != want {
			t.Errorf("ClientRoute(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestRecordChecks(t *testing.T) {
	svc := NewService(nil)
	for name, r := range map[string]Report{
		"no kind":    {Message: "x"},
		"no message": {Kind: KindClient, Message: "  "},
	} {
		if err := svc.Record(context.Background(), r); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := svc.Errors(context.Background(), ErrorFilter{Kind: "oops"}); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown kind: %v", err)
	}
	if got := cut("añb", 2); got != "a" {
		t.Errorf("cut split a character: %q", got)
	}
}

func newTestPool(t *testing.T) *pgxpool.Pool {
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
	if _, err := pool.Exec(ctx, `TRUNCATE users CASCADE; TRUNCATE error_events, db_size_samples`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	return pool
}

// Identical errors within an hour of the last fold into one row with a
// count and the latest request; later, or another error, is a row of its own.
func TestPostgresErrorList(t *testing.T) {
	pool := newTestPool(t)
	now := time.Now().UTC().Truncate(time.Microsecond)
	var recorded []Kind
	svc := NewService(NewPostgresStore(pool), WithClock(func() time.Time { return now }),
		WithRecorded(func(k Kind) { recorded = append(recorded, k) }))
	user := uuid.New()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO users (id, email, name, password_hash, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'ona@example.com', 'Ona', 'x', now(), now(), $1, $1)`, user); err != nil {
		t.Fatal(err)
	}
	in := func(id string) context.Context {
		return audit.WithRequest(context.Background(), audit.Request{ID: id, Source: audit.SourceWorkwear, UserID: user, UserAgent: "Firefox"})
	}
	boom := Report{Kind: KindServer, Route: "GET /api/v1/orders/{id}", Method: "GET", Status: 500, Message: "order 1234: boom"}
	if err := svc.Record(in("r1"), boom); err != nil {
		t.Fatal(err)
	}
	now = now.Add(30 * time.Minute)
	boom.Message = "order 5678: boom"
	if err := svc.Record(in("r2"), boom); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Hour)
	if err := svc.Record(in("r3"), boom); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Minute)
	if err := svc.Record(in("r4"), Report{Kind: KindClient, Route: ClientRoute("/orders/1"), Message: "TypeError: x is undefined"}); err != nil {
		t.Fatal(err)
	}

	page, err := svc.Errors(context.Background(), ErrorFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Errors) != 3 || page.Next != nil {
		t.Fatalf("rows = %+v", page.Errors)
	}
	folded := page.Errors[2]
	if folded.Count != 2 || *folded.LastRequestID != "r2" || folded.Message != "order 5678: boom" || *folded.LastUserName != "Ona" ||
		*folded.Status != 500 || *folded.Source != audit.SourceWorkwear || *folded.LastUserAgent != "Firefox" ||
		!folded.LastSeen.After(folded.FirstSeen) {
		t.Errorf("folded row = %+v", folded)
	}
	if page.Errors[1].Count != 1 || *page.Errors[1].LastRequestID != "r3" {
		t.Errorf("a recurrence after the hour = %+v", page.Errors[1])
	}
	if c := page.Errors[0]; c.Kind != KindClient || c.Route != "/orders/:id" || c.Status != nil {
		t.Errorf("client row = %+v", c)
	}
	if strings.Join([]string{string(recorded[0]), string(recorded[3])}, ",") != "server,client" {
		t.Errorf("recorded = %v", recorded)
	}
	if only, _ := svc.Errors(context.Background(), ErrorFilter{Kind: KindClient}); len(only.Errors) != 1 {
		t.Errorf("client errors = %d", len(only.Errors))
	}
	two, _ := svc.Errors(context.Background(), ErrorFilter{PageSize: 2})
	c, _ := audit.ParseCursor(*two.Next)
	if rest, _ := svc.Errors(context.Background(), ErrorFilter{After: &c}); len(rest.Errors) != 1 || rest.Errors[0].ID != folded.ID {
		t.Errorf("second page = %+v", rest.Errors)
	}
	if got, err := svc.Error(context.Background(), folded.ID); err != nil || got.Count != 2 {
		t.Errorf("one = %+v, %v", got, err)
	}
	if _, err := svc.Error(context.Background(), uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown = %v", err)
	}

	// The boom was first seen over a day before only if now moves on.
	if n, err := svc.NewErrorKinds(context.Background()); err != nil || n != 2 {
		t.Errorf("new kinds = %d, %v", n, err)
	}
	now = now.Add(23 * time.Hour)
	if n, _ := svc.NewErrorKinds(context.Background()); n != 1 {
		t.Errorf("a day on, new kinds = %d, want the client error only", n)
	}

	now = now.Add(Retention)
	if n, err := svc.Purge(context.Background()); err != nil || n != 3 {
		t.Errorf("purge = %d, %v", n, err)
	}
}

func TestPostgresDatabase(t *testing.T) {
	pool := newTestPool(t)
	now := time.Now().UTC()
	svc := NewService(NewPostgresStore(pool), WithClock(func() time.Time { return now }))
	ctx := context.Background()

	d, err := svc.Database(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if d.Version == "" || d.Bytes <= 0 || len(d.Tables) == 0 || d.Connections["active"] < 1 || d.MaxConnections < 1 ||
		d.LatestMigration == nil || d.Earlier != nil {
		t.Fatalf("database = %+v", d)
	}
	if err := svc.SampleSize(ctx); err != nil {
		t.Fatal(err)
	}
	if err := svc.SampleSize(ctx); err != nil {
		t.Fatal("a second sample the same day: ", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO db_size_samples VALUES (current_date - 40, 1000), (current_date - 31, 2000)`); err != nil {
		t.Fatal(err)
	}
	d, _ = svc.Database(ctx)
	if d.Earlier == nil || d.Earlier.Bytes != 2000 {
		t.Errorf("earlier = %+v, want the newest sample over 30 days old", d.Earlier)
	}
	// Leave no made-up history behind for whatever reads this database next.
	if _, err := pool.Exec(ctx, `TRUNCATE db_size_samples`); err != nil {
		t.Fatal(err)
	}
}
