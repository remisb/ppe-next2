package scan

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/personnel/document"
	"github.com/remisb/ppe-next2/internal/personnel/mrz"
	"github.com/remisb/ppe-next2/internal/sealbox"
)

// Store keeps the scans' sealed objects (internal/files' Store).
type Store interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

// Service is Personnel files' kept scans: Keep, List, Open and Remove for
// Import Documents' Scan Document, PurgeExpired for the upkeep. Without
// Personnel files' keys or a store it answers ErrNotConfigured.
type Service struct {
	repo  Repository
	keys  document.Keys
	store Store
	days  int
	now   func() time.Time
	newID func() uuid.UUID
	loc   *time.Location
}

// Option configures a Service.
type Option func(*Service)

// WithClock replaces the clock (UTC, microseconds, as Postgres stores them).
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// WithIDGenerator replaces uuid.New for scans and events.
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// WithDays is how many days a scan is kept (API_PERSONNEL_SCAN_DAYS).
func WithDays(days int) Option { return func(s *Service) { s.days = days } }

// WithLocation is the organisation's timezone (API_ORG_TIMEZONE), for the
// MRZ's centuries.
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

// NewService is the kept scans' service over Personnel files' keys (its
// master seals each scan's data key) and the files store.
func NewService(repo Repository, keys document.Keys, store Store, opts ...Option) *Service {
	s := &Service{repo: repo, keys: keys, store: store, days: DefaultDays,
		now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New, loc: time.UTC}
	for _, o := range opts {
		o(s)
	}
	return s
}

// configured reports whether the service has its keys and a store.
func (s *Service) configured() bool { return s.keys.Configured() && s.store != nil }

// The contexts each sealed value is bound to, so none opens for another scan.
func keyContext(id uuid.UUID) []byte  { return []byte("ppe.personnel.scan_key.v1|" + id.String()) }
func zipContext(id uuid.UUID) []byte  { return []byte("ppe.personnel.scan.v1|" + id.String()) }
func metaContext(id uuid.UUID) []byte { return []byte("ppe.personnel.scan_meta.v1|" + id.String()) }

// objectKey is where a scan's sealed zip is kept in the files store.
func objectKey(id uuid.UUID) string { return "personnel-scans/" + id.String() }

// Keep checks the pages and the meta, builds the zip (page-01.jpg …),
// seals it and its meta under a fresh data key, writes the object and then
// the row with its event. A failed row deletes the object again.
func (s *Service) Keep(ctx context.Context, meta Meta, pages [][]byte, actor uuid.UUID) (Scan, error) {
	if actor == uuid.Nil {
		return Scan{}, fieldError("actor", "is required")
	}
	if !s.configured() {
		return Scan{}, ErrNotConfigured
	}
	if err := meta.Validate(); err != nil {
		return Scan{}, err
	}
	if err := s.checkMRZ(meta); err != nil {
		return Scan{}, err
	}
	if err := checkPages(pages); err != nil {
		return Scan{}, err
	}
	archive, err := buildZip(pages)
	if err != nil {
		return Scan{}, err
	}

	now := s.now()
	id := s.newID()
	box, sealedKey, keyID, err := s.keys.NewDataKey(keyContext(id))
	if err != nil {
		return Scan{}, err
	}
	fileName := meta.FileName()
	plainMeta, err := json.Marshal(sealedMeta{Surname: meta.Surname, GivenNames: meta.GivenNames, Kind: meta.Kind,
		Number: meta.Number, FileName: fileName})
	if err != nil {
		return Scan{}, err
	}
	sealedMetaBytes, err := box.Seal(plainMeta, metaContext(id))
	if err != nil {
		return Scan{}, err
	}
	sealedZip, err := box.Seal(archive, zipContext(id))
	if err != nil {
		return Scan{}, err
	}
	sum := sha256.Sum256(archive)
	rec := Record{
		ID: id, CreatedBy: actor, CreatedAt: now, ExpiresAt: now.AddDate(0, 0, s.days), ObjectKey: objectKey(id),
		Bytes: len(archive), SHA256: sum[:], SealedKey: sealedKey, KeyID: keyID, SealedMeta: sealedMetaBytes, Pages: len(pages),
	}
	ev, err := audit.New(s.newID(), &actor, EventKept, EntityType, id, now, nil,
		map[string]any{"pages": rec.Pages, "expires_at": rec.ExpiresAt})
	if err != nil {
		return Scan{}, err
	}
	if err := s.store.Put(ctx, rec.ObjectKey, bytes.NewReader(sealedZip), int64(len(sealedZip)), "application/octet-stream"); err != nil {
		return Scan{}, err
	}
	if err := s.repo.Insert(ctx, rec, []audit.Event{ev}); err != nil {
		_ = s.store.Delete(context.WithoutCancel(ctx), rec.ObjectKey)
		return Scan{}, err
	}
	m := sealedMeta{Surname: meta.Surname, GivenNames: meta.GivenNames, Kind: meta.Kind, Number: meta.Number, FileName: fileName}
	return scanOf(rec, m), nil
}

// checkMRZ re-reads the lines, when Scan Document sent them, with the API's
// own parser: they must be a document's MRZ of the kind named. A reading
// with problems is still kept (the user checks the pages); the lines never are.
func (s *Service) checkMRZ(meta Meta) error {
	if len(meta.MRZ) == 0 {
		return nil
	}
	m := mrz.Parse(meta.MRZ, mrz.Options{Today: s.now().In(s.loc).Format(time.DateOnly)})
	if m == nil {
		return fieldError("mrz", "is not a passport's or ID card's machine-readable zone")
	}
	if (meta.Kind == Passport) != strings.HasPrefix(m.DocumentCode, "P") {
		return fieldError("kind", "does not match the document's code")
	}
	return nil
}

// checkPages: one to MaxPages pages, each a JPEG of at most 5 MB and 2400 px.
func checkPages(pages [][]byte) error {
	switch {
	case len(pages) == 0:
		return fieldError("pages", "are required")
	case len(pages) > MaxPages:
		return ErrTooManyPages
	}
	for _, p := range pages {
		if len(p) > document.MaxCopySize {
			return ErrPageTooLarge
		}
		if document.CheckJPEG(p) != nil {
			return ErrPageNotJPEG
		}
	}
	return nil
}

// buildZip is the archive: page-01.jpg … stored as they are (JPEGs do not
// compress), dated at the zip format's start so the same pages make the same zip.
func buildZip(pages [][]byte) ([]byte, error) {
	var b bytes.Buffer
	zw := zip.NewWriter(&b)
	for i, p := range pages {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: fmt.Sprintf("page-%02d.jpg", i+1), Method: zip.Store,
			Modified: time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC)})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(p); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return b.Bytes(), nil
}

// List is the actor's own scans not yet expired, newest first, their meta
// opened ([] when none).
func (s *Service) List(ctx context.Context, actor uuid.UUID) ([]Scan, error) {
	if !s.configured() {
		return nil, ErrNotConfigured
	}
	recs, err := s.repo.Live(ctx, actor, s.now())
	if err != nil {
		return nil, err
	}
	out := make([]Scan, 0, len(recs))
	for _, rec := range recs {
		box, err := s.keys.OpenDataKey(rec.SealedKey, rec.KeyID, keyContext(rec.ID))
		if err != nil {
			return nil, unopenable(err)
		}
		m, err := openMeta(box, rec)
		if err != nil {
			return nil, err
		}
		out = append(out, scanOf(rec, m))
	}
	return out, nil
}

// Open is the actor's own unexpired scan's zip and file name, its digest
// checked; the download is recorded before it is answered. Another user's
// scan, or an expired one, is ErrNotFound.
func (s *Service) Open(ctx context.Context, id, actor uuid.UUID) (Archive, error) {
	if actor == uuid.Nil {
		return Archive{}, fieldError("actor", "is required")
	}
	if !s.configured() {
		return Archive{}, ErrNotConfigured
	}
	rec, err := s.repo.Get(ctx, id, actor, s.now())
	if err != nil {
		return Archive{}, err
	}
	box, err := s.keys.OpenDataKey(rec.SealedKey, rec.KeyID, keyContext(rec.ID))
	if err != nil {
		return Archive{}, unopenable(err)
	}
	m, err := openMeta(box, rec)
	if err != nil {
		return Archive{}, err
	}
	obj, err := s.store.Get(ctx, rec.ObjectKey)
	if err != nil {
		return Archive{}, err
	}
	sealed, err := io.ReadAll(obj)
	obj.Close()
	if err != nil {
		return Archive{}, err
	}
	plain, err := box.Open(sealed, zipContext(rec.ID))
	if err != nil {
		return Archive{}, unopenable(err)
	}
	sum := sha256.Sum256(plain)
	if subtle.ConstantTimeCompare(sum[:], rec.SHA256) != 1 || len(plain) != rec.Bytes {
		return Archive{}, ErrUnopenable
	}
	ev, err := audit.New(s.newID(), &actor, EventDownloaded, EntityType, rec.ID, s.now(), nil, map[string]any{"pages": rec.Pages})
	if err != nil {
		return Archive{}, err
	}
	if err := s.repo.Record(ctx, []audit.Event{ev}); err != nil {
		return Archive{}, err
	}
	return Archive{FileName: m.FileName, Zip: plain}, nil
}

// Remove deletes the actor's own unexpired scan: its row (and so its key)
// with the event, then its object. Another user's is ErrNotFound.
func (s *Service) Remove(ctx context.Context, id, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	if !s.configured() {
		return ErrNotConfigured
	}
	now := s.now()
	rec, err := s.repo.Delete(ctx, id, actor, now, func(rec Record) ([]audit.Event, error) {
		ev, err := audit.New(s.newID(), &actor, EventRemoved, EntityType, rec.ID, now, map[string]any{"pages": rec.Pages}, nil)
		return []audit.Event{ev}, err
	})
	if err != nil {
		return err
	}
	// Unreadable without its key already; a failure leaves an object no row names.
	_ = s.store.Delete(context.WithoutCancel(ctx), rec.ObjectKey)
	return nil
}

// PurgeExpired erases every expired scan: the rows first, so their keys are
// gone, then their objects, best effort (logged). It is a rule applied every
// upkeep run, so after a restore it erases again what has expired. It
// returns how many scans went. Without keys or a store it does nothing.
func (s *Service) PurgeExpired(ctx context.Context, logger *slog.Logger) (int, error) {
	if s.store == nil {
		return 0, nil
	}
	keys, err := s.repo.DeleteExpired(ctx, s.now())
	if err != nil {
		return 0, err
	}
	for _, k := range keys {
		if err := s.store.Delete(context.WithoutCancel(ctx), k); err != nil {
			logger.Warn("an expired scan's object was not deleted", slog.String("object", k), slog.Any("error", err))
		}
	}
	return len(keys), nil
}

// openMeta opens a row's sealed meta with its data key.
func openMeta(box *sealbox.Box, rec Record) (sealedMeta, error) {
	plain, err := box.Open(rec.SealedMeta, metaContext(rec.ID))
	if err != nil {
		return sealedMeta{}, unopenable(err)
	}
	var m sealedMeta
	if err := json.Unmarshal(plain, &m); err != nil {
		return sealedMeta{}, ErrUnopenable
	}
	return m, nil
}

// unopenable is ErrUnopenable for a value that does not open, else err.
func unopenable(err error) error {
	if errors.Is(err, sealbox.ErrOpen) || errors.Is(err, document.ErrUnopenable) {
		return ErrUnopenable
	}
	return err
}

// scanOf is a row and its opened meta as List answers them.
func scanOf(rec Record, m sealedMeta) Scan {
	return Scan{ID: rec.ID, FileName: m.FileName, Surname: m.Surname, GivenNames: m.GivenNames, Kind: m.Kind,
		Number: m.Number, Pages: rec.Pages, Bytes: rec.Bytes, CreatedAt: rec.CreatedAt, ExpiresAt: rec.ExpiresAt}
}
