package company

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/remisb/ppe-next2/internal/db/dbtest"
)

func newTestPool(t *testing.T) (*pgxpool.Pool, uuid.UUID) {
	t.Helper()
	dsn := dbtest.DSN(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	actor := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'actor@example.com', 'Actor', 'x', now(), now(), $1, $1)`, actor); err != nil {
		t.Fatalf("insert actor: %v", err)
	}
	return pool, actor
}

func TestPostgresCompanies(t *testing.T) {
	pool, actor := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool))
	ctx := context.Background()

	if _, err := svc.Default(ctx); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no companies: Default err = %v", err)
	}
	a, err := svc.Create(ctx, Params{Code: "GV", Name: "UAB Gavort", CompanyCode: "300000001", VATCode: "LT100000000001",
		City: "Vilnius", Country: "LT", Notes: "Head office"}, actor)
	if err != nil || !a.IsDefault || a.Notes != "Head office" || a.EmployeeCount != 0 {
		t.Fatalf("first = %+v, %v", a, err)
	}
	b, err := svc.Create(ctx, Params{Name: "UAB Kitas"}, actor)
	if err != nil || b.IsDefault {
		t.Fatalf("second = %+v, %v", b, err)
	}
	if _, err := svc.Create(ctx, Params{Name: "Be kodo"}, actor); err != nil {
		t.Fatalf("two without a code: %v", err)
	}
	if _, err := svc.Create(ctx, Params{Code: "gv", Name: "X"}, actor); !errors.Is(err, ErrCodeTaken) {
		t.Fatalf("taken code: %v", err)
	}
	if _, err := svc.Update(ctx, b.ID, Params{Name: "UAB Kitas", Country: "lv"}, actor); err != nil {
		t.Fatal(err)
	}

	// Make Default moves it; the index allows one live default.
	if got, err := svc.MakeDefault(ctx, b.ID, actor); err != nil || !got.IsDefault || got.Country != "LV" {
		t.Fatalf("MakeDefault = %+v, %v", got, err)
	}
	if got, _ := svc.Get(ctx, a.ID); got.IsDefault {
		t.Fatal("the old default is still it")
	}
	list, err := svc.List(ctx)
	if err != nil || len(list) != 3 || list[0].ID != b.ID {
		t.Fatalf("List = %+v, %v", list, err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM companies WHERE is_default`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("defaults = %d, %v", n, err)
	}

	// An employee employed by a: Delete refuses until the employment ends.
	emp := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO employees (id, first_name, last_name, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, 'Ona', 'K', now(), now(), $2, $2)`, emp, actor); err != nil {
		t.Fatal(err)
	}
	job := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO employments (id, employee_id, company_id, started_on, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, $2, $3, '2026-01-01', now(), now(), $4, $4)`, job, emp, a.ID, actor); err != nil {
		t.Fatal(err)
	}
	if got, _ := svc.Get(ctx, a.ID); got.EmployeeCount != 1 {
		t.Fatalf("employee count = %d", got.EmployeeCount)
	}
	if err := svc.Delete(ctx, a.ID, actor); !errors.Is(err, ErrInUse) {
		t.Fatalf("in use: %v", err)
	}
	if err := svc.Delete(ctx, b.ID, actor); !errors.Is(err, ErrIsDefault) {
		t.Fatalf("default: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE employments SET ended_on = '2026-06-01' WHERE id = $1`, job); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, a.ID, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctx, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted read: %v", err)
	}
	// Its code is free again; the audit trail names each change.
	if _, err := svc.Create(ctx, Params{Code: "GV", Name: "UAB Gavort 2"}, actor); err != nil {
		t.Fatalf("code reused: %v", err)
	}
	var events []string
	rows, _ := pool.Query(ctx, `SELECT event FROM audit_events WHERE entity_id = $1 ORDER BY occurred_at, event`, b.ID)
	for rows.Next() {
		var e string
		_ = rows.Scan(&e)
		events = append(events, e)
	}
	if len(events) != 3 {
		t.Fatalf("b's events = %v", events)
	}
	if _, err := pool.Exec(ctx, `UPDATE companies SET is_default = true WHERE id = $1`, a.ID); err == nil {
		t.Fatal("a deleted company became the default")
	}
}
