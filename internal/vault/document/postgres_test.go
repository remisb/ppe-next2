package document

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/db/dbtest"
	"github.com/remisb/ppe-next2/internal/sealbox"
	"github.com/remisb/ppe-next2/internal/vault"
	"github.com/remisb/ppe-next2/internal/vault/extract"
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
	if _, err := owner.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users, outbox.jobs CASCADE`); err != nil {
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

// TestPostgresSealedDocuments: a sealed contract keeps nothing readable in
// its rows or the store, opens with its key, and the shredding (as ppe_app,
// through the owner's function) leaves a tombstone and deletes its files.
func TestPostgresSealedDocuments(t *testing.T) {
	app, owner, actor := newTestPool(t)
	ctx := context.Background()
	ana := addEmployee(t, owner, actor, "Ana", "Žukauskaitė")
	master, err := sealbox.NewKeyring(1, map[int16][]byte{1: bytes.Repeat([]byte{5}, sealbox.KeySize)})
	if err != nil {
		t.Fatal(err)
	}
	store := &memStore{files: map[string][]byte{}}
	ended := stubEmployments{}
	day := time.Date(2026, 11, 24, 9, 0, 0, 0, time.UTC)
	svc := NewService(NewPostgresRepository(app), stubSubjects{ana: {Label: "Ana Žukauskaitė"}}, WithFiles(store), WithKeys(master),
		WithEmployments(ended), WithClock(func() time.Time { return day }))
	clerk := Reader{ID: actor, Perms: []string{vault.PermEmploymentRead, vault.PermEmploymentManage}}

	d, err := svc.Upload(ctx, clerk, "employment.contract", Details{Title: "Darbo sutartis Nr. 7", Links: []LinkRef{{vault.Employee, ana}}},
		Upload{FileName: "sutartis.pdf", Data: pdf, Note: "2400 EUR"})
	if err != nil {
		t.Fatal(err)
	}
	if d.Title != "Darbo sutartis Nr. 7" || d.Current().Note != "2400 EUR" {
		t.Fatalf("answer = %q %q", d.Title, d.Current().Note)
	}
	var title, note, fileName string
	if err := owner.QueryRow(ctx, `SELECT d.title, v.note, f.file_name FROM vault.documents d JOIN vault.versions v ON v.document_id = d.id
		JOIN vault.files f ON f.version_id = v.id WHERE d.id = $1`, d.ID).Scan(&title, &note, &fileName); err != nil {
		t.Fatal(err)
	}
	if title != "" || note != "" || fileName != "document.pdf" {
		t.Errorf("stored in the clear: %q %q %q", title, note, fileName)
	}
	// Found by the employee's name, its title hidden from the list.
	p, err := svc.Search(ctx, clerk, Query{Words: "zukausk"})
	if err != nil || p.Total != 1 || p.Documents[0].Title != "" || !p.Documents[0].Sealed {
		t.Fatalf("search = %+v %v", p, err)
	}
	if _, data, err := svc.OpenSealed(ctx, clerk, d.ID, 1); err != nil || !bytes.Equal(data, pdf) {
		t.Fatalf("open = %v", err)
	}
	// Retention: the employment ended 2026-01-31, 50 years from 1 January after.
	ended[ana] = "2026-01-31"
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if res, err := svc.ShredDue(ctx, logger); err != nil || res.Documents != 0 {
		t.Fatalf("not due: %+v %v", res, err)
	}
	got, err := svc.Get(ctx, clerk, d.ID)
	if err != nil || got.RetainUntil == nil || *got.RetainUntil != "2077-01-01" {
		t.Fatalf("retain until = %v %v", got.RetainUntil, err)
	}
	// Held, the shredding function itself refuses.
	if _, err := svc.SetHold(ctx, clerk, d.ID, ptr("2026-12-31"), "Inspection"); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Exec(ctx, `SELECT vault.shred_document($1, now(), '2026-11-24')`, d.ID); err == nil {
		t.Error("shredded while held")
	}
	if _, err := svc.SetHold(ctx, clerk, d.ID, nil, ""); err != nil {
		t.Fatal(err)
	}
	// Removed, it is shredded at the next run.
	if err := svc.Remove(ctx, clerk, d.ID); err != nil {
		t.Fatal(err)
	}
	if res, err := svc.ShredDue(ctx, logger); err != nil || res.Documents != 1 {
		t.Fatalf("removed: %+v %v", res, err)
	}
	if len(store.files) != 0 {
		t.Errorf("files left: %d", len(store.files))
	}
	var rows int
	if err := owner.QueryRow(ctx, `SELECT (SELECT count(*) FROM vault.versions WHERE document_id = $1)
		+ (SELECT count(*) FROM vault.document_keys WHERE document_id = $1) + (SELECT count(*) FROM vault.links WHERE document_id = $1)`, d.ID).Scan(&rows); err != nil || rows != 0 {
		t.Errorf("left after shredding: %d %v", rows, err)
	}
	var shredded bool
	if err := owner.QueryRow(ctx, `SELECT shredded_at IS NOT NULL FROM vault.documents WHERE id = $1`, d.ID).Scan(&shredded); err != nil || !shredded {
		t.Errorf("tombstone = %v %v", shredded, err)
	}
	// ppe_app may not change a key in place, nor delete versions itself.
	for _, sql := range []string{`UPDATE vault.document_keys SET key_id = key_id`, `DELETE FROM vault.versions`} {
		if _, err := app.Exec(ctx, sql); err == nil {
			t.Errorf("%s: allowed", sql)
		}
	}
	if res, err := svc.ShredDue(ctx, logger); err != nil || res.Documents != 0 {
		t.Errorf("again: %+v %v", res, err)
	}
}

func TestPostgresReadText(t *testing.T) {
	app, owner, actor := newTestPool(t)
	ctx := context.Background()
	ana := addEmployee(t, owner, actor, "Ana", "Žukauskaitė")
	master, err := sealbox.NewKeyring(1, map[int16][]byte{1: bytes.Repeat([]byte{5}, sealbox.KeySize)})
	if err != nil {
		t.Fatal(err)
	}
	store := &memStore{files: map[string][]byte{}}
	text := &stubText{}
	svc := NewService(NewPostgresRepository(app), stubSubjects{ana: {Label: "Ana Žukauskaitė"}}, WithFiles(store), WithKeys(master),
		WithEmployments(stubEmployments{}), WithTextReader(text))
	boss := Reader{ID: actor, Perms: []string{vault.PermRead, vault.PermManage, vault.PermEmploymentRead, vault.PermEmploymentManage}}
	find := func(words string) int {
		t.Helper()
		p, err := svc.Search(ctx, boss, Query{Words: words})
		if err != nil {
			t.Fatal(err)
		}
		return p.Total
	}

	cert, err := svc.Upload(ctx, boss, "employee.certificate", Details{Title: "Pažymėjimas", Links: []LinkRef{{vault.Employee, ana}}},
		Upload{FileName: "c.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	// The upload's transaction wrote its job.
	var kind, key, payload string
	if err := owner.QueryRow(ctx, `SELECT kind, key, payload::text FROM outbox.jobs WHERE state = 'pending'`).Scan(&kind, &key, &payload); err != nil {
		t.Fatal(err)
	}
	if kind != KindReadText || key != cert.Current().ID.String() || payload != `{"version": "`+cert.Current().ID.String()+`"}` {
		t.Fatalf("job = %s %s %s", kind, key, payload)
	}

	text.res = extract.Result{Text: "Aukštalpinistų darbų saugos mokymai, Nr. 4711", Method: extract.MethodOCR, Language: "lit+eng", Pages: 1}
	if err := svc.ReadText(ctx, cert.Current().ID, false); err != nil {
		t.Fatal(err)
	}
	if find("aukstalpinist") != 1 || find("4711") != 1 {
		t.Fatal("the read text is not searched")
	}
	got, err := svc.Get(ctx, boss, cert.ID)
	if err != nil {
		t.Fatal(err)
	}
	v := got.Current()
	if v.TextState != TextRead || *v.TextMethod != extract.MethodOCR || *v.TextLanguage != "lit+eng" || *v.TextPages != 1 {
		t.Fatalf("version = %+v", v)
	}
	// A failed re-reading keeps the earlier words.
	if _, err := svc.ReadAgain(ctx, boss, cert.ID, 1); err != nil {
		t.Fatal(err)
	}
	text.err = errors.New("tesseract: exit status 1")
	if err := svc.ReadText(ctx, cert.Current().ID, true); err == nil {
		t.Fatal("no error")
	}
	if got, _ := svc.Get(ctx, boss, cert.ID); got.Current().TextState != TextFailed || *got.Current().TextError != "unreadable" || find("aukstalpinist") != 1 {
		t.Fatalf("after failing = %+v", got.Current())
	}
	text.err = nil

	// A sealed document keeps only words without digits, and no text.
	contract, err := svc.Upload(ctx, boss, "employment.contract", Details{Title: "Darbo sutartis", Links: []LinkRef{{vault.Employee, ana}}},
		Upload{FileName: "s.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	text.res = extract.Result{Text: "Sandėlininkė, alga 2400 EUR, asmens kodas 48001010000", Method: extract.MethodPDFText, Language: "lit", Pages: 3}
	if err := svc.ReadText(ctx, contract.Current().ID, false); err != nil {
		t.Fatal(err)
	}
	var content *string
	var tsv string
	if err := owner.QueryRow(ctx, `SELECT content, tsv::text FROM vault.version_text WHERE version_id = $1`, contract.Current().ID).Scan(&content, &tsv); err != nil {
		t.Fatal(err)
	}
	if content != nil || strings.Contains(tsv, "2400") || strings.Contains(tsv, "4800") || !strings.Contains(tsv, "sandelinink") {
		t.Fatalf("sealed text kept: %v %s", content, tsv)
	}
	if find("sandelinink") != 1 {
		t.Fatal("the sealed document's words are not searched")
	}

	// The reindex queues what is waiting, once.
	if _, err := owner.Exec(ctx, `UPDATE outbox.jobs SET state = 'done', finished_at = now()`); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.Exec(ctx, `UPDATE vault.version_text SET state = 'failed' WHERE version_id = $1`, contract.Current().ID); err != nil {
		t.Fatal(err)
	}
	if _, err := owner.Exec(ctx, `UPDATE vault.version_text SET state = 'pending' WHERE version_id = $1`, cert.Current().ID); err != nil {
		t.Fatal(err)
	}
	if n, err := svc.QueueUnread(ctx, false); err != nil || n != 1 {
		t.Fatalf("queue pending = %d, %v", n, err)
	}
	if n, err := svc.QueueUnread(ctx, true); err != nil || n != 1 {
		t.Fatalf("queue failed too = %d, %v (the pending one is queued already)", n, err)
	}
}

// TestPostgresRetentionNotSealed: an invoice past its 10 years is shredded by
// vault.shred_document as ppe_app, leaving a tombstone with no title,
// versions, files or links; one within them stays, with its day.
func TestPostgresRetentionNotSealed(t *testing.T) {
	app, owner, actor := newTestPool(t)
	ctx := context.Background()
	store := &memStore{files: map[string][]byte{}}
	day := time.Date(2026, 11, 24, 9, 0, 0, 0, time.UTC)
	svc := NewService(NewPostgresRepository(app), stubSubjects{}, WithFiles(store), WithClock(func() time.Time { return day }))
	mgr := Reader{ID: actor, Perms: []string{vault.PermRead, vault.PermManage}}
	upload := func(title, date string) Document {
		t.Helper()
		d, err := svc.Upload(ctx, mgr, "invoice", Details{Title: title, DocumentDate: &date}, Upload{FileName: "s.pdf", Data: pdf})
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	old, recent := upload("UAB Rūbai 2015", "2015-06-01"), upload("UAB Rūbai 2020", "2020-06-01")
	res, err := svc.ShredDue(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil || res.Documents != 1 || res.Failed != 0 {
		t.Fatalf("shred = %+v %v", res, err)
	}
	var title string
	var shredded bool
	var versions, links int
	if err := owner.QueryRow(ctx, `SELECT d.title, d.shredded_at IS NOT NULL,
		(SELECT count(*) FROM vault.versions v WHERE v.document_id = d.id), (SELECT count(*) FROM vault.links l WHERE l.document_id = d.id)
		FROM vault.documents d WHERE d.id = $1`, old.ID).Scan(&title, &shredded, &versions, &links); err != nil {
		t.Fatal(err)
	}
	if title != "" || !shredded || versions != 0 || links != 0 || len(store.files) != 1 {
		t.Errorf("tombstone = %q %v %d %d, %d files left", title, shredded, versions, links, len(store.files))
	}
	got, err := svc.Get(ctx, mgr, recent.ID)
	if err != nil || got.RetainUntil == nil || *got.RetainUntil != "2031-01-01" {
		t.Errorf("2020 invoice = %v %v", got.RetainUntil, err)
	}
}
