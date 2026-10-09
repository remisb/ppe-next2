package asset

import (
	"context"
	"errors"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
)

// newTestPool connects to API_TEST_DB_DSN (skipping when unset), empties the
// tables, and inserts an actor and two employees. It returns a pool connected
// as the API's role ppe_app, and the owner's for setup and checks.
func newTestPool(t *testing.T) (app, owner *pgxpool.Pool, actor uuid.UUID, emps [2]EmployeeView) {
	t.Helper()
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	owner, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	if _, err := owner.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users, asset_number_counters CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	actor = uuid.New()
	if _, err := owner.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'actor@example.com', 'Actor', 'x', now(), now(), $1, $1)`, actor); err != nil {
		t.Fatalf("insert actor: %v", err)
	}
	for i, name := range [][2]string{{"Jonas", "Petraitis"}, {"Rūta", "Kazlauskienė"}} {
		emps[i] = EmployeeView{ID: uuid.New(), FirstName: name[0], LastName: name[1]}
		if _, err := owner.Exec(ctx, `INSERT INTO employees (id, first_name, last_name, created_at, updated_at,
			created_by_user_id, updated_by_user_id) VALUES ($1, $2, $3, now(), now(), $4, $4)`, emps[i].ID, name[0], name[1], actor); err != nil {
			t.Fatalf("insert employee: %v", err)
		}
	}
	return dbtest.AppPool(t, owner, dsn), owner, actor, emps
}

func newPostgresService(app *pgxpool.Pool) *Service {
	return NewService(NewPostgresRepository(app), WithLocation(vilnius))
}

func addSIM(t *testing.T, svc *Service, actor uuid.UUID, number, simNo string, status Status) View {
	t.Helper()
	v, err := svc.Create(context.Background(), CreateParams{Kind: KindSIM, ConnectionStatus: &status, Params: Params{
		InventoryNo: number, SimNo: &simNo, PhoneNo: sp("+370 612 40118"), Provider: sp("Telia"), Plan: sp("Biz 10 GB"),
		NonReturnValueCents: ip(2500),
	}}, actor)
	if err != nil {
		t.Fatalf("add %s: %v", number, err)
	}
	return v
}

func giveNow(svc *Service, id uuid.UUID, emp EmployeeView, actor uuid.UUID) (AssignmentView, error) {
	ctx := context.Background()
	fp := FormParams{EmployeeID: emp.ID, GivenDate: time.Now().In(vilnius).Format(time.DateOnly)}
	prev, err := svc.Preview(ctx, id, fp)
	if err != nil {
		return AssignmentView{}, err
	}
	return svc.Give(ctx, id, GiveParams{FormParams: fp, PaperFormSigned: true, FormHash: prev.DocumentHash}, actor)
}

func TestPostgresAssetLifecycle(t *testing.T) {
	app, owner, actor, emps := newTestPool(t)
	svc := newPostgresService(app)
	ctx := context.Background()

	v := addSIM(t, svc, actor, "SIM-000001", "0089370011", StatusNotActivated)
	if v.Location != LocationOffice || *v.SimNo != "0089370011" {
		t.Errorf("new SIM: %s, %q", v.Location, *v.SimNo)
	}
	if _, err := giveNow(svc, v.ID, emps[0], actor); !errors.Is(err, ErrNotActive) {
		t.Errorf("give not activated: %v", err)
	}
	if _, err := svc.ChangeStatus(ctx, v.ID, "ACTIVE", actor); err != nil {
		t.Fatal(err)
	}
	a, err := giveNow(svc, v.ID, emps[0], actor)
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, v.ID)
	if err != nil || got.Location != LocationWithEmployee || got.Open == nil || got.Open.EmployeeName != "Jonas Petraitis" {
		t.Fatalf("after giving: %+v, %v", got.View, err)
	}
	// The form comes back from JSONB with its keys reordered and still
	// matches its hash.
	f, err := svc.Form(ctx, v.ID, a.ID)
	if err != nil || f.DocumentHash != *a.DocumentHash || !strings.HasPrefix(string(f.Form), `{"template_version":"2026-10-plain"`) {
		t.Errorf("stored form = %s %s, %v", f.Form, f.DocumentHash, err)
	}
	if _, err := svc.ChangeStatus(ctx, v.ID, "BLOCKED", actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MarkNotReturned(ctx, v.ID, NotReturnedParams{Whereabouts: "UNKNOWN", Comment: "Left without notice"}, actor); err != nil {
		t.Fatal(err)
	}
	s, err := svc.Summary(ctx, "SIM")
	if err != nil || s.Total != 1 || s.InOffice != 0 || s.WithEmployees != 1 || s.NotReturned != 1 || !slices.Equal(s.Providers, []string{"Telia"}) {
		t.Errorf("summary = %+v, %v", s, err)
	}
	for _, c := range []struct {
		p    ListParams
		want int
	}{
		{ListParams{Kind: "SIM", Location: "UNKNOWN"}, 1},
		{ListParams{Kind: "SIM", Held: "true"}, 1},
		{ListParams{Kind: "SIM", Location: "WITH_EMPLOYEE"}, 0},
		{ListParams{Kind: "SIM", Location: "OFFICE"}, 0},
		{ListParams{Kind: "SIM", Status: "BLOCKED", NotReturned: "true"}, 1},
		{ListParams{Kind: "SIM", Q: "petraitis"}, 1},
		{ListParams{Kind: "SIM", Q: "612 40"}, 1},
		{ListParams{Kind: "SIM", Q: "00893 70011"}, 1},
		{ListParams{Kind: "SIM", EmployeeID: &emps[1].ID}, 0},
		{ListParams{Kind: "SIM", Provider: "telia", Sort: "holder", Dir: "desc"}, 1},
		{ListParams{Kind: "EQUIPMENT"}, 0},
	} {
		res, err := svc.List(ctx, c.p)
		if err != nil || res.Total != c.want || len(res.Assets) != c.want {
			t.Errorf("%+v: total %d, %d rows, %v; want %d", c.p, res.Total, len(res.Assets), err, c.want)
		}
	}
	back, err := svc.Return(ctx, v.ID, ReturnParams{}, actor)
	if err != nil || back.NotReturnedAt == nil {
		t.Fatalf("return = %+v, %v", back, err)
	}
	got, _ = svc.Get(ctx, v.ID)
	if got.Location != LocationOffice || *got.ConnectionStatus != StatusBlocked || len(got.Assignments) != 1 {
		t.Errorf("after return: %s, %s, %d assignments", got.Location, *got.ConnectionStatus, len(got.Assignments))
	}
	held, err := svc.ByEmployee(ctx, emps[0].ID)
	if err != nil || len(held) != 1 || held[0].Asset.InventoryNo != "SIM-000001" || held[0].Open() {
		t.Errorf("by employee = %+v, %v", held, err)
	}
	var events int
	if err := owner.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_type = 'asset' AND entity_id = $1`, v.ID).Scan(&events); err != nil || events != 6 {
		t.Errorf("%d events, %v; want registered, 2 status changes, given, marked, returned", events, err)
	}
}

func TestPostgresNumbersAreNeverReused(t *testing.T) {
	app, owner, actor, _ := newTestPool(t)
	svc := newPostgresService(app)
	ctx := context.Background()
	first := addSIM(t, svc, actor, "SIM-000001", "8937 0011", StatusActive)
	var dup *DuplicateError
	_, err := svc.Create(ctx, CreateParams{Kind: KindSIM, Params: Params{InventoryNo: "SIM-000002", SimNo: sp("89370011"), Provider: sp("Bitė")}}, actor)
	if !errors.Is(err, ErrSIMNoTaken) || !errors.As(err, &dup) || dup.ExistingID() != first.ID {
		t.Errorf("same SIM number: %v", err)
	}
	_, err = svc.Create(ctx, CreateParams{Kind: KindSIM, Params: Params{InventoryNo: "sim-000001", SimNo: sp("1"), Provider: sp("Bitė")}}, actor)
	if !errors.Is(err, ErrInventoryNoTaken) || !errors.As(err, &dup) || dup.ExistingID() != first.ID {
		t.Errorf("same inventory number: %v", err)
	}
	// Correct the number: the old one stays used.
	if _, err := svc.Update(ctx, first.ID, Params{InventoryNo: "SIM-000010", SimNo: first.SimNo, PhoneNo: first.PhoneNo, Provider: first.Provider,
		Plan: first.Plan, NonReturnValueCents: first.NonReturnValueCents, ReceivedDate: first.ReceivedDate}, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, CreateParams{Kind: KindSIM, Params: Params{InventoryNo: "SIM-000001", SimNo: sp("2"), Provider: sp("Bitė")}}, actor); !errors.Is(err, ErrInventoryNoTaken) {
		t.Errorf("a corrected-away number: %v", err)
	}
	if n, err := svc.NextNumber(ctx, "SIM"); err != nil || n != "SIM-000002" {
		t.Errorf("next = %s, %v", n, err)
	}
	if _, err := svc.Create(ctx, CreateParams{Kind: KindEquipment, Params: Params{InventoryNo: "PC-000007", Name: sp("Laptop"), Category: ptr(CategoryComputer)}}, actor); err != nil {
		t.Fatal(err)
	}
	if n, _ := svc.NextNumber(ctx, "PC"); n != "PC-000008" {
		t.Errorf("next PC = %s", n)
	}
	var stored int
	if err := owner.QueryRow(ctx, `SELECT count(*) FROM asset_numbers`).Scan(&stored); err != nil || stored != 3 {
		t.Errorf("%d numbers used, %v; want SIM-000001, SIM-000010 and PC-000007", stored, err)
	}
}

func TestPostgresConcurrentGiveGivesOnce(t *testing.T) {
	app, owner, actor, emps := newTestPool(t)
	svc := newPostgresService(app)
	v := addSIM(t, svc, actor, "SIM-000001", "1", StatusActive)
	var wg sync.WaitGroup
	errs := make([]error, 8)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = giveNow(svc, v.ID, emps[i%2], actor)
		}(i)
	}
	wg.Wait()
	given := 0
	for _, err := range errs {
		switch {
		case err == nil:
			given++
		case !errors.Is(err, ErrAlreadyGiven):
			t.Errorf("unexpected: %v", err)
		}
	}
	var rows int
	if err := owner.QueryRow(context.Background(), `SELECT count(*) FROM asset_assignments WHERE asset_id = $1`, v.ID).Scan(&rows); err != nil || given != 1 || rows != 1 {
		t.Errorf("%d gave, %d assignments, %v; want exactly one", given, rows, err)
	}
}

func TestPostgresAssignmentsCannotBeRewritten(t *testing.T) {
	app, owner, actor, emps := newTestPool(t)
	svc := newPostgresService(app)
	ctx := context.Background()
	v := addSIM(t, svc, actor, "SIM-000001", "1", StatusActive)
	a, err := giveNow(svc, v.ID, emps[0], actor)
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`UPDATE asset_assignments SET given_date = given_date - 1 WHERE id = $1`,
		`UPDATE asset_assignments SET employee_id = (SELECT id FROM employees WHERE id <> employee_id LIMIT 1) WHERE id = $1`,
		`UPDATE asset_assignments SET form = '{}' WHERE id = $1`,
		`DELETE FROM asset_assignments WHERE id = $1`,
	} {
		if _, err := owner.Exec(ctx, sql, a.ID); err == nil {
			t.Errorf("%s succeeded", sql)
		}
	}
	// A second open assignment is refused by the index, whatever the code does.
	if _, err := owner.Exec(ctx, `INSERT INTO asset_assignments (id, asset_id, employee_id, given_date, given_by_user_id,
		created_at, paper_form_signed) VALUES ($1, $2, $3, current_date, $4, now(), false)`, uuid.New(), v.ID, emps[1].ID, actor); err == nil {
		t.Error("second open assignment inserted")
	}
	if _, err := svc.MarkNotReturned(ctx, v.ID, NotReturnedParams{Whereabouts: "WITH_EMPLOYEE"}, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.Exec(ctx, `UPDATE asset_assignments SET whereabouts = 'UNKNOWN' WHERE id = $1`, a.ID); err == nil {
		t.Error("the Not Returned mark was changed")
	}
	if _, err := svc.Return(ctx, v.ID, ReturnParams{}, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.Exec(ctx, `UPDATE asset_assignments SET returned_date = NULL, returned_at = NULL,
		returned_by_user_id = NULL, return_comment = NULL WHERE id = $1`, a.ID); err == nil {
		t.Error("a returned assignment was reopened")
	}
}
