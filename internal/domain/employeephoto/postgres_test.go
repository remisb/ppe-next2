package employeephoto

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/files"
)

func pngBytes(t *testing.T, shade uint8) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for x := 0; x < 4; x++ {
		img.Set(x, 0, color.RGBA{shade, 0, 0, 255})
	}
	var b bytes.Buffer
	if err := png.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func setup(t *testing.T) (*Service, *pgxpool.Pool, uuid.UUID, uuid.UUID) {
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
	if _, err := pool.Exec(ctx, `SET LOCAL ppe.allow_truncate = on; TRUNCATE users CASCADE`); err != nil {
		t.Fatal(err)
	}
	actor, emp := uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, name, password_hash, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'actor@example.com', 'Actor', 'x', now(), now(), $1, $1)`, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO employees (id, first_name, last_name, notes, created_at, updated_at,
		created_by_user_id, updated_by_user_id) VALUES ($1, 'Jonas', 'Petraitis', '', now(), now(), $2, $2)`, emp, actor); err != nil {
		t.Fatal(err)
	}
	dir, err := files.NewDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return NewService(NewPostgresRepository(pool), WithFiles(dir)), pool, emp, actor
}

func TestPostgresPhotoLifecycle(t *testing.T) {
	svc, pool, emp, actor := setup(t)
	ctx := context.Background()

	a, err := svc.Add(ctx, emp, Upload{FileName: "a.png", Data: pngBytes(t, 10)}, []string{UseReceipt, UseProfile, UseProfile}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if !a.IsDefault || len(a.Uses) != 2 || a.Uses[0] != UseProfile {
		t.Errorf("first photo = %+v, want default with uses [profile receipt]", a)
	}
	b, err := svc.Add(ctx, emp, Upload{FileName: "b.png", Data: pngBytes(t, 20)}, nil, actor)
	if err != nil {
		t.Fatal(err)
	}
	if b.IsDefault || len(b.Uses) != 0 {
		t.Errorf("second photo = %+v, want not default, no uses", b)
	}

	if _, err := svc.Add(ctx, emp, Upload{FileName: "x.pdf", Data: []byte("%PDF-1.4 x")}, nil, actor); !errors.Is(err, ErrFileType) {
		t.Errorf("pdf: %v, want ErrFileType", err)
	}
	if _, err := svc.Add(ctx, emp, Upload{FileName: "a.png", Data: pngBytes(t, 1)}, []string{"selfie"}, actor); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown use: %v, want ErrInvalid", err)
	}
	if _, err := svc.Add(ctx, uuid.New(), Upload{FileName: "a.png", Data: pngBytes(t, 1)}, nil, actor); !errors.Is(err, ErrEmployeeNotFound) {
		t.Errorf("unknown employee: %v, want ErrEmployeeNotFound", err)
	}

	if _, err := svc.SetUses(ctx, emp, b.ID, []string{UseIDBadge, UseSizing}, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SetDefault(ctx, emp, b.ID, actor); err != nil {
		t.Fatal(err)
	}
	ps, err := svc.List(ctx, emp)
	if err != nil {
		t.Fatal(err)
	}
	if len(ps) != 2 || ps[0].ID != b.ID || !ps[0].IsDefault || ps[1].IsDefault || len(ps[0].Uses) != 2 {
		t.Fatalf("after changes: %+v", ps)
	}
	var def *uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT (SELECT p.id FROM employee_photos p WHERE p.employee_id = e.id AND p.is_default AND p.deleted_at IS NULL) FROM employees e WHERE e.id = $1`, emp).Scan(&def); err != nil || def == nil || *def != b.ID {
		t.Errorf("default photo = %v, %v", def, err)
	}

	// Removing the default promotes the remaining photo.
	if err := svc.Remove(ctx, emp, b.ID, actor); err != nil {
		t.Fatal(err)
	}
	if ps, _ = svc.List(ctx, emp); len(ps) != 1 || ps[0].ID != a.ID || !ps[0].IsDefault {
		t.Errorf("after removing the default: %+v", ps)
	}
	if _, _, err := svc.Open(ctx, emp, b.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("open removed: %v, want ErrNotFound", err)
	}
	_, r, err := svc.Open(ctx, emp, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	r.Close()
	if err := svc.Remove(ctx, emp, a.ID, actor); err != nil {
		t.Fatal(err)
	}

	for ev, want := range map[string]int{EventAdded: 2, EventUsesChanged: 1, EventDefaultChanged: 3, EventRemoved: 2} {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id = $1 AND event = $2`, emp, ev).Scan(&n); err != nil || n != want {
			t.Errorf("%s events = %d (%v), want %d", ev, n, err, want)
		}
	}
}
