package usage

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
)

// countingStore counts the activity written.
type countingStore struct {
	Store
	writes int
}

func (c *countingStore) RecordActivity(context.Context, time.Time, uuid.UUID, string) error {
	c.writes++
	return nil
}

// Seen writes once per user, app and day in a process.
func TestSeenWritesOncePerDay(t *testing.T) {
	store := &countingStore{}
	now := time.Date(2026, 10, 7, 9, 0, 0, 0, time.UTC)
	svc := NewService(store, WithClock(func() time.Time { return now }))
	ona, jonas := uuid.New(), uuid.New()
	ctx := context.Background()
	for range 3 {
		_ = svc.Seen(ctx, ona, "workwear")
	}
	_ = svc.Seen(ctx, ona, "admin")
	_ = svc.Seen(ctx, jonas, "workwear")
	if store.writes != 3 {
		t.Errorf("writes = %d, want 3", store.writes)
	}
	now = now.Add(24 * time.Hour)
	_ = svc.Seen(ctx, ona, "workwear")
	if store.writes != 4 {
		t.Errorf("the next day: writes = %d, want 4", store.writes)
	}
}

func TestPostgresReport(t *testing.T) {
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	if _, err := owner.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users, audit_seals, audit_purges, data_quality_samples CASCADE`); err != nil {
		t.Fatal(err)
	}
	app := dbtest.AppPool(t, owner, dsn)
	vilnius, _ := time.LoadLocation("Europe/Vilnius")
	now := time.Now().UTC().Truncate(time.Microsecond)
	svc := NewService(NewPostgresStore(app), WithLocation(vilnius), WithClock(func() time.Time { return now }))

	ona := uuid.New()
	if _, err := owner.Exec(ctx, `
		INSERT INTO users (id, email, name, password_hash, created_at, updated_at, created_by_user_id, updated_by_user_id, language)
		VALUES ($1, 'ona@example.com', 'Ona', 'x', now(), now(), $1, $1, 'lt');
		`, ona); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.Exec(ctx, `
		INSERT INTO roles (id, key, name, created_at, updated_at) VALUES ('a0e1d000-0000-4000-8000-000000000003', 'employee', 'Employee', now(), now())
		ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.Exec(ctx, `INSERT INTO user_roles VALUES ($1, 'a0e1d000-0000-4000-8000-000000000003')`, ona); err != nil {
		t.Fatal(err)
	}
	for _, a := range []string{"workwear", "workwear", "admin"} {
		if err := svc.Seen(ctx, ona, a); err != nil {
			t.Fatal(err)
		}
	}
	if err := NewService(NewPostgresStore(app), WithLocation(vilnius), WithClock(func() time.Time { return now.AddDate(0, 0, -3) })).
		Seen(ctx, ona, "workwear"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SampleQuality(ctx, Quality{Employees: 4, EmployeesMissingSizes: 1, CatalogueActive: 9, CatalogueUnpriced: 2, ItemSetsActive: 1}); err != nil {
		t.Fatal(err)
	}
	if err := svc.SampleQuality(ctx, Quality{Employees: 5, EmployeesMissingSizes: 1, CatalogueActive: 9, CatalogueUnpriced: 2, ItemSetsActive: 1}); err != nil {
		t.Fatal("a second sample the same day: ", err)
	}

	r, err := svc.Report(ctx)
	if err != nil {
		t.Fatal(err)
	}
	last := Days - 1
	if len(r.Days) != Days || r.Days[last] != now.In(vilnius).Format(time.DateOnly) || len(r.Weeks) != Weeks {
		t.Fatalf("days %v … weeks %v", r.Days[last], r.Weeks)
	}
	if r.Active.Total[last] != 1 || r.Active.ByApp["workwear"][last] != 1 || r.Active.ByApp["admin"][last] != 1 ||
		r.Active.Total[last-3] != 1 || r.Active.Last7 != 1 || r.Active.Last30 != 1 || r.Active.Users != 1 {
		t.Errorf("active = %+v", r.Active)
	}
	found := false
	for _, s := range r.Active.ByRole {
		if s.Role.Key != nil && *s.Role.Key == "employee" {
			found = s.Values[last] == 1
		}
	}
	if !found {
		t.Errorf("by role = %+v", r.Active.ByRole)
	}
	if r.UserLanguages["lt"] != 1 || len(r.Quality) != 1 || r.Quality[0].Employees != 5 {
		t.Errorf("languages %v, quality %+v", r.UserLanguages, r.Quality)
	}
	if len(r.Changes) == 0 || r.Funnel != (Funnel{}) {
		t.Errorf("changes %v, funnel %+v", r.Changes, r.Funnel)
	}
	if n, err := svc.PurgeActivity(ctx); err != nil || n != 0 {
		t.Errorf("purge = %d, %v", n, err)
	}
}
