package aiusage

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
)

func pgStore(t *testing.T) (*PostgresStore, *pgxpool.Pool, uuid.UUID) {
	t.Helper()
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
	if _, err := owner.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users, audit_seals, audit_purges CASCADE`); err != nil {
		t.Fatal(err)
	}
	user := uuid.New()
	if _, err := owner.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'ai@example.com', 'Ai', 'x', now(), now(), $1, $1)`, user); err != nil {
		t.Fatal(err)
	}
	return NewPostgresStore(dbtest.AppPool(t, owner, dsn)), owner, user
}

func TestPostgresLedger(t *testing.T) {
	store, owner, user := pgStore(t)
	ctx := context.Background()
	emp := uuid.New()
	if _, err := owner.Exec(ctx, `INSERT INTO employees (id, first_name, last_name, notes, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'Jonas', 'Pavyzdys', '', now(), now(), $2, $2)`, emp, user); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	s := NewService(store, WithClock(func() time.Time { return now }))
	prices := DefaultPrices["gpt-image-2"]
	req := Request{Operation: PortraitColorize, Provider: ProviderOpenAI, Model: "gpt-image-2", Prices: &prices, UserID: user, EmployeeID: &emp}
	for range 2 {
		if err := s.Run(ctx, req, func(context.Context) (Result, error) {
			return Result{Tokens: Tokens{InputImage: 1000, OutputImage: 4160}, ProviderRequestID: "req_x"}, nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if spent, err := s.SpentThisMonth(ctx); err != nil || spent != 2*132800 {
		t.Errorf("spent = %d, %v", spent, err)
	}
	r, err := s.Report(ctx, store, nil)
	if err != nil || r.ThisMonth.Calls != 2 || len(r.ByOperation) != 1 || r.ByOperation[0].Key != "portrait.colorize" || r.ByUser[0].Key != user.String() {
		t.Errorf("report = %+v, %v", r, err)
	}
	calls, err := store.Calls(ctx, Filter{Operation: PortraitColorize, UserID: user})
	if err != nil || len(calls) != 2 || calls[0].Prices != prices || calls[0].ProviderRequestID != "req_x" || *calls[0].EmployeeID != emp {
		t.Errorf("calls = %+v, %v", calls, err)
	}
	if got, _ := store.Calls(ctx, Filter{Outcome: Failed}); len(got) != 0 {
		t.Errorf("failed calls = %d", len(got))
	}
	// Append-only for the API's role, but for the shredding's one change.
	_, err = store.pool.Exec(ctx, `UPDATE ai_usage SET cost_micro_usd = 0`)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
		t.Errorf("ppe_app updating the ledger = %v", err)
	}
	if err := store.ClearEmployee(ctx, emp); err != nil {
		t.Fatal(err)
	}
	if calls, _ := store.Calls(ctx, Filter{}); calls[0].EmployeeID != nil || calls[0].CostMicroUSD != 132800 {
		t.Errorf("after clearing = %+v", calls[0])
	}
}

func TestPostgresSettings(t *testing.T) {
	store, _, user := pgStore(t)
	ctx := context.Background()
	s := NewSettingsService(store, keyring(t))
	if got, err := s.Settings(ctx); err != nil || got.Enabled || got.Model != "gpt-image-2" {
		t.Fatalf("defaults = %+v, %v", got, err)
	}
	budget := int64(5_000_000)
	if _, err := s.Update(ctx, SettingsInput{Enabled: true, Model: "gpt-image-2", Quality: "high", Prices: DefaultPrices, BudgetMicroUSD: &budget}, user); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetKey(ctx, "sk-proj-0123456789abcdefWXYZ", user); err != nil {
		t.Fatal(err)
	}
	got, err := s.Settings(ctx)
	if err != nil || !got.Enabled || got.Quality != "high" || *got.BudgetMicroUSD != budget || got.Key == nil || got.Key.Last4 != "WXYZ" || got.Key.SetByID != user {
		t.Errorf("settings = %+v, %v", got, err)
	}
	if k, err := s.Key(ctx); err != nil || k != "sk-proj-0123456789abcdefWXYZ" {
		t.Errorf("key = %q, %v", k, err)
	}
	if _, err := s.RemoveKey(ctx, user); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Settings(ctx); got.Key != nil || !got.Enabled {
		t.Errorf("after removal = %+v", got)
	}
}
