package document

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
	"github.com/remisb/ppe-next2/internal/files"
)

// pgSetup empties the test database, adds an acting user, and returns the
// service on the real repository, connected as ppe_app (its grants), with a
// folder for the files store.
func pgSetup(t *testing.T) (*Service, *pgxpool.Pool, uuid.UUID) {
	t.Helper()
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	owner, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	if _, err := owner.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users CASCADE`); err != nil {
		t.Fatal(err)
	}
	actor := uuid.New()
	if _, err := owner.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'actor@example.com', 'Actor', 'x', now(), now(), $1, $1)`, actor); err != nil {
		t.Fatal(err)
	}
	app := dbtest.AppPool(t, owner, dsn)
	store, err := files.NewDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := NewService(NewPostgresRepository(app), testKeys(t), store, WithClock(func() time.Time { return today }))
	return svc, owner, actor
}

func count(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPostgresSaveSupersedeAndEmployeeRecord(t *testing.T) {
	svc, owner, actor := pgSetup(t)
	ctx := context.Background()

	first, err := svc.Save(ctx, passportParams(t, jonas, uuid.Nil), actor)
	if err != nil {
		t.Fatal(err)
	}
	var first0, last0 string
	if err := owner.QueryRow(ctx, `SELECT first_name, last_name FROM employees WHERE id = $1`, first.EmployeeID).Scan(&first0, &last0); err != nil {
		t.Fatal(err)
	}
	if first0 != "Jonas" || last0 != "Pavyzdys" {
		t.Errorf("new employee = %s %s", first0, last0)
	}
	if n := count(t, owner, `SELECT count(*) FROM personnel.subject_keys WHERE employee_id = $1`, first.EmployeeID); n != 1 {
		t.Errorf("data keys = %d, want 1", n)
	}

	renewed := jonas
	renewed.number, renewed.expiry = "93456789", "360101"
	p := passportParams(t, renewed, first.EmployeeID)
	p.AddToEmployeeRecord = true
	p.Take = []Take{TakeBirthDate, TakeNationality}
	p.IssuedOn = "2026-01-02"
	second, err := svc.Save(ctx, p, actor)
	if err != nil {
		t.Fatal(err)
	}

	docs, err := svc.Documents(ctx, first.EmployeeID)
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != 2 || docs[0].ID != second.ID || docs[0].SupersededAt != nil || docs[1].SupersededAt == nil {
		t.Fatalf("documents = %+v", docs)
	}
	if d := docs[0]; d.IssuedOn == nil || *d.IssuedOn != "2026-01-02" || d.ExpiresOn != "2036-01-01" || !d.OnEmployeeRecord ||
		len(d.Copies) != 1 || d.Copies[0] != SidePage {
		t.Errorf("second document = %+v", d)
	}
	var birth, nationality *string
	if err := owner.QueryRow(ctx, `SELECT birth_date::text, nationality FROM employees WHERE id = $1`, first.EmployeeID).Scan(&birth, &nationality); err != nil {
		t.Fatal(err)
	}
	if birth == nil || *birth != "1933-09-24" || nationality == nil || *nationality != "LTU" {
		t.Errorf("employee birth date, nationality = %v, %v", birth, nationality)
	}
	if n := count(t, owner, `SELECT count(*) FROM audit_events WHERE entity_id = $1 AND event LIKE 'personnel.%'`, first.EmployeeID); n != 3 {
		t.Errorf("personnel events = %d, want recorded, superseded, recorded", n)
	}
	// PR-2: nothing read from the document in the trail, or plain in the row.
	for _, v := range []string{"91234567", "93456789", "33309240064", "1933-09-24"} {
		if n := count(t, owner, `SELECT count(*) FROM audit_events WHERE entity_id = $1
			AND (coalesce(before::text, '') LIKE '%' || $2 || '%' OR coalesce(after::text, '') LIKE '%' || $2 || '%')
			AND event LIKE 'personnel.%'`, first.EmployeeID, v); n != 0 {
			t.Errorf("%d personnel events hold %s", n, v)
		}
		if n := count(t, owner, `SELECT count(*) FROM personnel.identity_documents WHERE position(convert_to($1, 'UTF8') in sealed) > 0`, v); n != 0 {
			t.Errorf("a sealed row holds %s in plain", v)
		}
	}
}

func TestPostgresSameDocumentAtTheSameMoment(t *testing.T) {
	svc, owner, actor := pgSetup(t)
	ctx := context.Background()
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = svc.Save(ctx, passportParams(t, jonas, uuid.Nil), actor)
		}()
	}
	wg.Wait()
	ok, dup := 0, 0
	for _, err := range errs {
		var d *DuplicateError
		switch {
		case err == nil:
			ok++
		case errors.As(err, &d):
			dup++
		default:
			t.Errorf("save: %v", err)
		}
	}
	if ok != 1 || dup != 1 {
		t.Fatalf("two saves of one document: %d saved, %d duplicates (%v)", ok, dup, errs)
	}
	// The loser's employee, subject and document went with its transaction.
	if n := count(t, owner, `SELECT count(*) FROM employees`); n != 1 {
		t.Errorf("employees = %d, want 1", n)
	}
	if n := count(t, owner, `SELECT count(*) FROM personnel.subjects`); n != 1 {
		t.Errorf("subjects = %d, want 1", n)
	}
}

func TestPostgresOnePersonalCodeOnTwoEmployeesAtTheSameMoment(t *testing.T) {
	svc, _, actor := pgSetup(t)
	ctx := context.Background()
	twin := jonas
	twin.number = "97777777"
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, p := range []person{jonas, twin} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = svc.Save(ctx, passportParams(t, p, uuid.Nil), actor)
		}()
	}
	wg.Wait()
	var d *DuplicateError
	switch {
	case errs[0] == nil && errors.As(errs[1], &d), errs[1] == nil && errors.As(errs[0], &d):
		if d.What != duplicateOtherEmployee {
			t.Errorf("duplicate = %s, want other_employee", d.What)
		}
	default:
		t.Fatalf("one personal code on two new employees: %v", errs)
	}
}

func TestPostgresAppRoleMayNotChangeADataKey(t *testing.T) {
	svc, owner, actor := pgSetup(t)
	ctx := context.Background()
	doc, err := svc.Save(ctx, passportParams(t, jonas, uuid.Nil), actor)
	if err != nil {
		t.Fatal(err)
	}
	app := dbtest.AppPool(t, owner, os.Getenv("API_TEST_DB_DSN"))
	_, err = app.Exec(ctx, `UPDATE personnel.subject_keys SET key_id = 2 WHERE employee_id = $1`, doc.EmployeeID)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
		t.Errorf("ppe_app updating a data key = %v, want permission denied", err)
	}
	if _, err := app.Exec(ctx, `SELECT count(*) FROM personnel.identity_documents`); err != nil {
		t.Errorf("ppe_app reading documents: %v", err)
	}
}
