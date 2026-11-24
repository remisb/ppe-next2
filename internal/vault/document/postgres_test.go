package document

import (
	"context"
	"errors"
	"os"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
	"github.com/remisb/ppe-next2/internal/vault"
)

// newTestPool empties the test database and returns a pool connected as the
// API's role, ppe_app, the owner's pool, and an actor.
func newTestPool(t *testing.T) (app, owner *pgxpool.Pool, actor uuid.UUID) {
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
	if _, err := owner.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	actor = uuid.New()
	if _, err := owner.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'actor@example.com', 'Actor', 'x', now(), now(), $1, $1)`, actor); err != nil {
		t.Fatalf("insert actor: %v", err)
	}
	return dbtest.AppPool(t, owner, dsn), owner, actor
}

// addEmployee inserts a live employee named first last.
func addEmployee(t *testing.T, owner *pgxpool.Pool, actor uuid.UUID, first, last string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := owner.Exec(context.Background(), `INSERT INTO employees (id, first_name, last_name, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, $2, $3, now(), now(), $4, $4)`, id, first, last, actor); err != nil {
		t.Fatalf("insert employee: %v", err)
	}
	return id
}

func TestPostgresDocuments(t *testing.T) {
	app, owner, actor := newTestPool(t)
	ctx := context.Background()
	ana := addEmployee(t, owner, actor, "Ana", "Žukauskaitė")
	jonas := addEmployee(t, owner, actor, "Jonas", "Petraitis")
	laptop := uuid.New()
	subs := stubSubjects{
		ana: {Label: "Ana Žukauskaitė"}, jonas: {Label: "Jonas Petraitis"},
		laptop: {Label: "EQ-0001 Laptop", Requires: []string{"equipment.read"}},
	}
	store := &memStore{files: map[string][]byte{}}
	svc := NewService(NewPostgresRepository(app), subs, WithFiles(store))
	boss := Reader{ID: actor, Perms: []string{vault.PermRead, vault.PermManage, "equipment.read"}}
	plain := Reader{ID: actor, Perms: []string{vault.PermRead, vault.PermManage}}

	cert, err := svc.Upload(ctx, boss, "employee.certificate", Details{
		Title: "Darbas aukštyje", DocumentDate: ptr("2026-03-01"), ValidUntil: ptr("2028-03-01"),
		Links: []LinkRef{{vault.Employee, ana}},
	}, Upload{FileName: "aukstis.pdf", Data: pdf, Note: "original"})
	if err != nil {
		t.Fatal(err)
	}
	if cert.Current().CreatedByName != "Actor" || cert.Current().TextState != "pending" || *cert.DocumentDate != "2026-03-01" {
		t.Fatalf("read back = %+v / %+v", cert, cert.Current())
	}
	warranty, err := svc.Upload(ctx, boss, "asset.document", Details{Title: "Garantija", Links: []LinkRef{{vault.Asset, laptop}}},
		Upload{FileName: "warranty.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}

	find := func(r Reader, words string) []uuid.UUID {
		t.Helper()
		p, err := svc.Search(ctx, r, Query{Words: words})
		if err != nil {
			t.Fatal(err)
		}
		var ids []uuid.UUID
		for _, h := range p.Documents {
			ids = append(ids, h.ID)
		}
		return ids
	}
	// Accents folded, prefixes, linked names, the type's words in any language.
	for _, words := range []string{"zukausk", "ŽUKAUSKAITĖ", "aukst", "darbas ana", "pažymėjimas", "certif", "aukstis"} {
		if got := find(boss, words); !slices.Equal(got, []uuid.UUID{cert.ID}) {
			t.Errorf("%q found %v, want the certificate", words, got)
		}
	}
	// Near spelling: nothing matches the words, trigrams do.
	p, err := svc.Search(ctx, boss, Query{Words: "Zukauskiate"})
	if err != nil || !p.Near || len(p.Documents) != 1 || p.Documents[0].ID != cert.ID {
		t.Errorf("near spelling = %+v, %v", p, err)
	}
	// requires: the laptop's document needs equipment.read.
	if got := find(plain, "garantija"); len(got) != 0 {
		t.Errorf("without equipment.read: %v", got)
	}
	if got := find(boss, ""); len(got) != 2 {
		t.Errorf("everything = %v", got)
	}
	if hits, err := svc.BySubject(ctx, boss, LinkRef{vault.Employee, ana}); err != nil || len(hits) != 1 || hits[0].Links[0].Label != "Ana Žukauskaitė" {
		t.Errorf("by subject = %+v, %v", hits, err)
	}

	// Update: a link moves, the search follows.
	if _, err := svc.Update(ctx, boss, cert.ID, Details{Title: "Darbas aukštyje", Links: []LinkRef{{vault.Employee, jonas}}}); err != nil {
		t.Fatal(err)
	}
	if got := find(boss, "petrait"); !slices.Equal(got, []uuid.UUID{cert.ID}) {
		t.Errorf("after relinking: %v", got)
	}
	if got := find(boss, "zukausk"); len(got) != 0 {
		t.Errorf("the old link is still found: %v", got)
	}

	// A newer version; then the label refresh after a rename.
	second := append(slices.Clone(pdf), []byte("% 2\n")...)
	d, err := svc.AddVersion(ctx, boss, cert.ID, Upload{FileName: "aukstis-2.pdf", Data: second})
	if err != nil || d.Current().Number != 2 || len(d.Versions) != 2 || d.Versions[1].Number != 1 {
		t.Fatalf("add version = %+v, %v", d.Versions, err)
	}
	subs[jonas] = SubjectInfo{Label: "Jonas Jonaitis"}
	if n, err := svc.RefreshLabels(ctx); err != nil || n != 1 {
		t.Errorf("refresh = %d, %v", n, err)
	}
	if got := find(boss, "jonait"); !slices.Equal(got, []uuid.UUID{cert.ID}) {
		t.Errorf("after the rename: %v", got)
	}

	// Remove: gone from reads and search.
	if err := svc.Remove(ctx, boss, warranty.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctx, boss, warranty.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("removed: %v", err)
	}

	// The trail: versions and files are never changed or deleted, even by the owner.
	for _, sql := range []string{`UPDATE vault.versions SET note = 'x'`, `DELETE FROM vault.files`} {
		var pgErr *pgconn.PgError
		if _, err := owner.Exec(ctx, sql); !errors.As(err, &pgErr) {
			t.Errorf("%s: %v", sql, err)
		}
	}
	// An archived document's source is unique.
	if _, err := owner.Exec(ctx, `INSERT INTO vault.documents (id, type, title, origin, source_kind, source_id, created_at,
		created_by_user_id, updated_at, updated_by_user_id) VALUES ($1, 'other', 'a', 'archived', 'order', $2, now(), $3, now(), $3),
		($4, 'other', 'b', 'archived', 'order', $2, now(), $3, now(), $3)`, uuid.New(), uuid.New(), actor, uuid.New()); err == nil {
		t.Error("two documents of one source")
	}
}

// TestPostgresDocumentNumbersAndEvents: the events are in the trail, each on the document.
func TestPostgresDocumentEvents(t *testing.T) {
	app, owner, actor := newTestPool(t)
	ctx := context.Background()
	svc := NewService(NewPostgresRepository(app), stubSubjects{}, WithFiles(&memStore{files: map[string][]byte{}}))
	boss := Reader{ID: actor, Perms: []string{vault.PermRead, vault.PermManage}}
	d, err := svc.Upload(ctx, boss, "invoice", Details{Title: "Sąskaita 15"}, Upload{FileName: "s.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Update(ctx, boss, d.ID, Details{Title: "Sąskaita 16"}); err != nil {
		t.Fatal(err)
	}
	rows, err := owner.Query(ctx, `SELECT event FROM audit_events WHERE entity_type = $1 AND entity_id = $2 ORDER BY occurred_at, event`, Entity, d.ID)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for rows.Next() {
		var e string
		if err := rows.Scan(&e); err != nil {
			t.Fatal(err)
		}
		got = append(got, e)
	}
	if !slices.Equal(got, []string{EventUploaded, EventUpdated}) {
		t.Errorf("events = %v", got)
	}
}
