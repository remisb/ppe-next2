package employee

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// pgCompanies answers Companies from the companies table, as cmd/api's
// adapter answers it from the company service.
type pgCompanies struct{ pool *pgxpool.Pool }

func (c pgCompanies) CompanyName(ctx context.Context, id uuid.UUID) (string, bool, error) {
	var name string
	err := c.pool.QueryRow(ctx, `SELECT name FROM companies WHERE id = $1 AND deleted_at IS NULL`, id).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return name, err == nil, err
}

func insertCompany(t *testing.T, pool *pgxpool.Pool, actor uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := pool.Exec(context.Background(), `INSERT INTO companies (id, name, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, $2, now(), now(), $3, $3)`, id, name, actor); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestPostgresEmployments(t *testing.T) {
	pool, actor := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool), WithCompanies(pgCompanies{pool}))
	ctx := context.Background()
	a, b := insertCompany(t, pool, actor, "UAB A"), insertCompany(t, pool, actor, "UAB B")

	cand, err := svc.Create(ctx, Params{FirstName: "Lukas", LastName: "Kandidatas"}, everything, actor)
	if err != nil {
		t.Fatal(err)
	}
	emp, err := svc.Create(ctx, Params{FirstName: "Ona", LastName: "Darbuotoja",
		Employment: &EmployParams{CompanyID: a, StartedOn: sp2("2026-01-10")}}, everything, actor)
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, emp.ID)
	if err != nil || got.Status != StatusEmployee || got.Company == nil || got.Company.Name != "UAB A" ||
		len(got.Employments) != 1 || *got.Employments[0].StartedOn != "2026-01-10" {
		t.Fatalf("employee = %+v, %v", got, err)
	}
	if got, _ := svc.Get(ctx, cand.ID); got.Status != StatusCandidate || got.Company != nil || len(got.Employments) != 0 {
		t.Fatalf("candidate = %+v", got)
	}
	if countEvents(t, pool, emp.ID, EventEmployed) != 1 {
		t.Error("employed event missing")
	}

	// Move to Another Company: one ends, the next opens, in one transaction.
	got, err = svc.Employ(ctx, emp.ID, EmployParams{CompanyID: b, StartedOn: sp2("2026-04-01"), EndCurrent: true}, everything, actor)
	if err != nil || got.Company == nil || got.Company.ID != b || len(got.Employments) != 2 || !got.Employments[0].Open() {
		t.Fatalf("moved = %+v, %v", got, err)
	}
	if got.Employments[1].EndedOn == nil || *got.Employments[1].EndedOn != "2026-04-01" {
		t.Fatalf("the old period = %+v", got.Employments[1])
	}
	// The open-period index stands behind the service.
	if _, err := pool.Exec(ctx, `INSERT INTO employments (id, employee_id, company_id, created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, $2, $3, now(), now(), $4, $4)`, uuid.New(), emp.ID, a, actor); err == nil {
		t.Fatal("a second open employment was stored")
	}
	if _, err := pool.Exec(ctx, `UPDATE employments SET ended_on = '2025-01-01' WHERE id = $1`, got.Employments[0].ID); err == nil {
		t.Fatal("an end before the start was stored")
	}

	// A deleted company is refused.
	gone := insertCompany(t, pool, actor, "Gone")
	if _, err := pool.Exec(ctx, `UPDATE companies SET deleted_at = now(), deleted_by_user_id = $2 WHERE id = $1`, gone, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Employ(ctx, cand.ID, EmployParams{CompanyID: gone}, everything, actor); !errors.Is(err, ErrCompanyNotFound) {
		t.Fatalf("deleted company: %v", err)
	}

	// End, then the list's statuses.
	got, err = svc.EndEmployment(ctx, emp.ID, got.Employments[0].ID, "2026-09-30", everything, actor)
	if err != nil || got.Status != StatusFormer || got.Company != nil {
		t.Fatalf("ended = %+v, %v", got, err)
	}
	all, err := svc.List(ctx)
	if err != nil || len(all) != 2 {
		t.Fatalf("List = %+v, %v", all, err)
	}
	for _, e := range all {
		want := map[uuid.UUID]Status{cand.ID: StatusCandidate, emp.ID: StatusFormer}[e.ID]
		if e.Status != want {
			t.Errorf("%s: status %s, want %s", e.FullName(), e.Status, want)
		}
	}

	// Removing every period makes a candidate again.
	for _, m := range got.Employments {
		if got, err = svc.RemoveEmployment(ctx, emp.ID, m.ID, everything, actor); err != nil {
			t.Fatal(err)
		}
	}
	if got.Status != StatusCandidate || len(got.Employments) != 0 {
		t.Fatalf("all removed = %+v", got)
	}
}

func TestPostgresMergeMovesEmployments(t *testing.T) {
	pool, actor := newTestPool(t)
	svc := NewService(NewPostgresRepository(pool), WithCompanies(pgCompanies{pool}))
	ctx := context.Background()
	a := insertCompany(t, pool, actor, "UAB A")
	keep, _ := svc.Create(ctx, Params{FirstName: "Ona", LastName: "K", Employment: &EmployParams{CompanyID: a, StartedOn: sp2("2026-02-01")}}, everything, actor)
	remove, _ := svc.Create(ctx, Params{FirstName: "Ona", LastName: "K.", Employment: &EmployParams{CompanyID: a, StartedOn: sp2("2025-01-01")}}, everything, actor)
	p := Params{FirstName: "Ona", LastName: "K"}
	if _, err := svc.Merge(ctx, keep.ID, remove.ID, p, everything, actor); !errors.Is(err, ErrBothEmployed) {
		t.Fatalf("both employed: %v", err)
	}
	prev, err := svc.MergePreview(ctx, keep.ID, remove.ID)
	if err != nil || !prev.Contents.BothEmployed || len(prev.Contents.Employments) != 1 {
		t.Fatalf("preview = %+v, %v", prev.Contents, err)
	}
	r, _ := svc.Get(ctx, remove.ID)
	if _, err := svc.EndEmployment(ctx, remove.ID, r.Employments[0].ID, "2026-01-31", everything, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Merge(ctx, keep.ID, remove.ID, p, everything, actor); err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, keep.ID)
	if err != nil || got.Status != StatusEmployee || len(got.Employments) != 2 {
		t.Fatalf("kept = %+v, %v", got, err)
	}
}
