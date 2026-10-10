package asset

import (
	"context"
	"errors"
	"io"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
	"github.com/remisb/ppe-next2/internal/files"
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
	s, err := svc.Summary(ctx, "SIM", all)
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
		res, err := svc.List(ctx, c.p, all)
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
	held, err := svc.ByEmployee(ctx, emps[0].ID, all)
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
	// Edit took SIM-000010, which raises the counter as Add does.
	if n, err := svc.NextNumber(ctx, "SIM"); err != nil || n != "SIM-000011" {
		t.Errorf("next = %s, %v", n, err)
	}
	if _, err := svc.Create(ctx, CreateParams{Kind: KindEquipment, Params: Params{InventoryNo: "PC-000007", Name: sp("Laptop"), Category: ptr(CategoryComputer)}}, actor); err != nil {
		t.Fatal(err)
	}
	if n, _ := svc.NextNumber(ctx, "PC"); n != "PC-000008" {
		t.Errorf("next PC = %s", n)
	}
	for _, c := range []struct {
		p    ListParams
		want int
	}{
		{ListParams{Kind: "EQUIPMENT", Category: "COMPUTER", Sort: "name"}, 1},
		{ListParams{Kind: "EQUIPMENT", Category: "FURNITURE"}, 0},
		{ListParams{Kind: "EQUIPMENT", Q: "lapt"}, 1},
	} {
		if res, err := svc.List(ctx, c.p, all); err != nil || res.Total != c.want {
			t.Errorf("%+v: %d, %v; want %d", c.p, res.Total, err, c.want)
		}
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

// A second Return or Mark as Not Returned that waited for the first one's lock
// sees it done (409), not the assignment as it was before (a trigger error, 500).
func TestPostgresConcurrentReturnAndMarkAnswerConflict(t *testing.T) {
	app, _, actor, emps := newTestPool(t)
	svc := newPostgresService(app)
	ctx := context.Background()
	for _, c := range []struct {
		name, number string
		do           func(id uuid.UUID) error
		want         error
	}{
		{"return", "SIM-000001", func(id uuid.UUID) error {
			_, err := svc.Return(ctx, id, ReturnParams{}, actor)
			return err
		}, ErrNotGiven},
		{"not returned", "SIM-000002", func(id uuid.UUID) error {
			_, err := svc.MarkNotReturned(ctx, id, NotReturnedParams{Whereabouts: string(WhereaboutsUnknown)}, actor)
			return err
		}, ErrAlreadyMarked},
	} {
		t.Run(c.name, func(t *testing.T) {
			v := addSIM(t, svc, actor, c.number, c.number[4:], StatusActive)
			if _, err := giveNow(svc, v.ID, emps[0], actor); err != nil {
				t.Fatal(err)
			}
			var wg sync.WaitGroup
			errs := make([]error, 8)
			for i := range errs {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					errs[i] = c.do(v.ID)
				}(i)
			}
			wg.Wait()
			done := 0
			for _, err := range errs {
				switch {
				case err == nil:
					done++
				case !errors.Is(err, c.want):
					t.Errorf("unexpected: %v", err)
				}
			}
			if done != 1 {
				t.Errorf("%d succeeded, want exactly one", done)
			}
		})
	}
}

// SIM numbers compare without spaces and in either case: an ICCID may end in
// a hex digit typed in capitals or not.
func TestPostgresSIMNumbersIgnoreCase(t *testing.T) {
	app, _, actor, _ := newTestPool(t)
	svc := newPostgresService(app)
	first := addSIM(t, svc, actor, "SIM-000001", "8937 0012 34F", StatusActive)
	_, err := svc.Create(context.Background(), CreateParams{Kind: KindSIM, Params: Params{
		InventoryNo: "SIM-000002", SimNo: sp("89370012 34f"), Provider: sp("Telia"),
	}}, actor)
	var dup *DuplicateError
	if !errors.Is(err, ErrSIMNoTaken) || !errors.As(err, &dup) || dup.ExistingID() != first.ID {
		t.Errorf("same SIM number in lower case: %v", err)
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

// Signed copies: stored, listed newest first on their assignment, counted out
// of the Signed Copy Missing filter, and never changed or deleted.
func TestPostgresSignedCopies(t *testing.T) {
	app, owner, actor, emps := newTestPool(t)
	ctx := context.Background()
	store, err := files.NewDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := NewService(NewPostgresRepository(app), WithLocation(vilnius), WithFiles(store))
	v := addSIM(t, svc, actor, "SIM-000001", "1", StatusActive)
	other := addSIM(t, svc, actor, "SIM-000002", "2", StatusActive)
	given, err := giveNow(svc, v.ID, emps[0], actor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := giveNow(svc, other.ID, emps[1], actor); err != nil {
		t.Fatal(err)
	}
	missing := func() int {
		res, err := svc.List(ctx, ListParams{Kind: "SIM", SignedCopy: "missing"}, all)
		if err != nil {
			t.Fatal(err)
		}
		return res.Total
	}
	if n := missing(); n != 2 {
		t.Errorf("missing before = %d, want 2", n)
	}
	first, err := svc.UploadSignedCopy(ctx, v.ID, given.ID, Upload{FileName: "scan.pdf", Data: []byte("%PDF-1.7 first")}, actor)
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.UploadSignedCopy(ctx, v.ID, given.ID, Upload{FileName: "again.pdf", Data: []byte("%PDF-1.7 second")}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if n := missing(); n != 1 {
		t.Errorf("missing after = %d, want 1", n)
	}
	d, err := svc.Get(ctx, v.ID)
	if err != nil {
		t.Fatal(err)
	}
	as := d.Assignments[0]
	if !as.SignedCopyUploaded || len(as.SignedCopies) != 2 || as.SignedCopies[0].ID != second.ID || as.SignedCopies[1].UploadedByName != "Actor" {
		t.Errorf("assignment = %+v", as)
	}
	if d.Open == nil || !d.Open.SignedCopyUploaded {
		t.Errorf("the open assignment does not say it has a copy: %+v", d.Open)
	}
	got, r, err := svc.SignedCopy(ctx, v.ID, given.ID, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(r)
	r.Close()
	if string(b) != "%PDF-1.7 first" || got.FileName != "scan.pdf" {
		t.Errorf("read %q as %+v", b, got)
	}
	if _, _, err := svc.SignedCopy(ctx, other.ID, given.ID, first.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("through another asset: %v", err)
	}
	if _, err := svc.UploadSignedCopy(ctx, other.ID, given.ID, Upload{FileName: "x.pdf", Data: []byte("%PDF-x")}, actor); !errors.Is(err, ErrAssignmentNotFound) {
		t.Errorf("onto another asset's assignment: %v", err)
	}
	for _, sql := range []string{
		`UPDATE asset_signed_copies SET file_name = 'other.pdf' WHERE id = $1`,
		`DELETE FROM asset_signed_copies WHERE id = $1`,
	} {
		if _, err := owner.Exec(ctx, sql, first.ID); err == nil {
			t.Errorf("%s succeeded", sql)
		}
	}
}
