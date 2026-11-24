package document

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/sealbox"
	"github.com/remisb/ppe-next2/internal/vault"
)

// Sealed types (phase 2, docs/specs/vault-service.md "Sealed types"): each
// document has a data key of its own, sealed by the master keyring
// (API_VAULT_KEY); its title, files and versions' notes and file names are
// sealed with it. The plain columns are only what lists, search and
// retention need: type, number, dates, links, sizes, hashes.

// The events of sealed documents and retention.
const (
	// EventOpened: a sealed document's file opened, recorded before it is sent.
	EventOpened = "vault.document_opened"
	// EventHoldSet and EventHoldCleared: a Legal Hold, its day and reason.
	EventHoldSet     = "vault.hold_set"
	EventHoldCleared = "vault.hold_cleared"
	// EventShredded: a sealed document made unreadable by its retention rule
	// (or after Remove), by no one; its type, number and dates.
	EventShredded = "vault.document_shredded"
)

// Employments is the port to People: when an employee's employment ended,
// for retention. Ended is false while they are employed, were never
// employed, or are not found; on is their last period's end (YYYY-MM-DD).
type Employments interface {
	EmploymentEnded(ctx context.Context, employee uuid.UUID) (ended bool, on string, err error)
}

// WithKeys sets the master keyring sealed documents' keys are sealed by.
// Without it, sealed types answer ErrNotConfigured.
func WithKeys(master sealbox.Sealer) Option { return func(s *Service) { s.keys = master } }

// WithEmployments sets where employment ends are read, for retention.
func WithEmployments(e Employments) Option { return func(s *Service) { s.employments = e } }

// WithLocation sets the timezone retention's days are counted in (API_ORG_TIMEZONE).
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

// The contexts each sealed value is bound to, so none opens in another row.
func keyContext(doc uuid.UUID) []byte      { return []byte("ppe.vault.document_key.v1|" + doc.String()) }
func titleContext(doc uuid.UUID) []byte    { return []byte("ppe.vault.title.v1|" + doc.String()) }
func fileContext(file uuid.UUID) []byte    { return []byte("ppe.vault.file.v1|" + file.String()) }
func dataContext(version uuid.UUID) []byte { return []byte("ppe.vault.data.v1|" + version.String()) }

// sealedData is what a sealed version keeps sealed.
type sealedData struct {
	FileName string `json:"file_name"`
	Note     string `json:"note"`
}

// today is the day in the organisation's timezone, YYYY-MM-DD.
func (s *Service) today() string { return s.now().In(s.loc).Format(time.DateOnly) }

// newKey is a fresh data key for document id, and it sealed.
func (s *Service) newKey(id uuid.UUID) (*sealbox.Box, []byte, int16, error) {
	if s.keys == nil {
		return nil, nil, 0, ErrNotConfigured
	}
	return sealbox.NewDataKey(s.keys, keyContext(id))
}

// openKey opens a sealed document's data key.
func (s *Service) openKey(d Document) (*sealbox.Box, error) {
	if s.keys == nil {
		return nil, ErrNotConfigured
	}
	if len(d.Key) == 0 {
		return nil, fmt.Errorf("vault: sealed document %s has no key", d.ID)
	}
	box, err := sealbox.OpenDataKey(s.keys, d.Key, d.KeyID, keyContext(d.ID))
	if err != nil {
		return nil, fmt.Errorf("vault: document %s's key: %w", d.ID, err)
	}
	return box, nil
}

// sealVersion seals v's note and file name into DataSealed, and data (the
// file) with box, leaving plain only the file's type, size and hash; the
// stored file is named "document" with its extension.
func sealVersion(box *sealbox.Box, v *Version, data []byte) ([]byte, error) {
	raw, err := json.Marshal(sealedData{FileName: v.File.FileName, Note: v.Note})
	if err != nil {
		return nil, err
	}
	if v.DataSealed, err = box.Seal(raw, dataContext(v.ID)); err != nil {
		return nil, err
	}
	v.Note = ""
	v.File.FileName = "document" + files.Ext(v.File.ContentType)
	v.File.Sealed = true
	return box.Seal(data, fileContext(v.File.ID))
}

// unseal fills a sealed document's title, notes and file names when the keys
// are here; without them, or once shredded, they stay empty.
func (s *Service) unseal(d *Document) error {
	if !d.Sealed || s.keys == nil || len(d.Key) == 0 {
		return nil
	}
	box, err := s.openKey(*d)
	if err != nil {
		return err
	}
	if len(d.TitleSealed) > 0 {
		title, err := box.Open(d.TitleSealed, titleContext(d.ID))
		if err != nil {
			return fmt.Errorf("vault: document %s's title: %w", d.ID, err)
		}
		d.Title = string(title)
	}
	for i := range d.Versions {
		v := &d.Versions[i]
		if len(v.DataSealed) == 0 {
			continue
		}
		raw, err := box.Open(v.DataSealed, dataContext(v.ID))
		if err != nil {
			return fmt.Errorf("vault: version %s: %w", v.ID, err)
		}
		var data sealedData
		if err := json.Unmarshal(raw, &data); err != nil {
			return err
		}
		v.Note, v.File.FileName = data.Note, data.FileName
	}
	return nil
}

// OpenSealed is a sealed document's version n, recorded (vault.document_opened)
// before it is read: its bytes opened with the document's key and checked
// against the hash taken when it was stored. The route asks for a recent sign-in.
func (s *Service) OpenSealed(ctx context.Context, reader Reader, id uuid.UUID, n int) (File, []byte, error) {
	if s.store == nil {
		return File{}, nil, ErrNoStorage
	}
	d, err := s.repo.Get(ctx, id)
	if err != nil {
		return File{}, nil, err
	}
	if !reader.holdsAll(d.Requires) {
		return File{}, nil, ErrNotFound
	}
	if !d.Sealed {
		return File{}, nil, fieldError("document", "is not sealed: download it")
	}
	if err := s.unseal(&d); err != nil {
		return File{}, nil, err
	}
	i := slices.IndexFunc(d.Versions, func(v Version) bool { return v.Number == n })
	if i < 0 {
		return File{}, nil, ErrNotFound
	}
	f := d.Versions[i].File
	ev, err := s.event(reader.ID, EventOpened, id, s.now(), nil, map[string]any{
		"type": d.Type, "version": n, "content_type": f.ContentType, "size_bytes": f.SizeBytes, "sha256": f.SHA256,
	})
	if err != nil {
		return File{}, nil, err
	}
	if err := s.repo.Record(ctx, ev); err != nil {
		return File{}, nil, err
	}
	box, err := s.openKey(d)
	if err != nil {
		return File{}, nil, err
	}
	r, err := s.store.Get(ctx, f.ObjectKey)
	if err != nil {
		return File{}, nil, fmt.Errorf("vault: file %s: %w", f.ID, err)
	}
	defer r.Close()
	sealed, err := io.ReadAll(r)
	if err != nil {
		return File{}, nil, fmt.Errorf("vault: reading file %s: %w", f.ID, err)
	}
	data, err := box.Open(sealed, fileContext(f.ID))
	if err != nil {
		return File{}, nil, fmt.Errorf("%w: file %s does not open", ErrDamaged, f.ID)
	}
	if sum := sha256.Sum256(data); hex.EncodeToString(sum[:]) != f.SHA256 {
		return File{}, nil, fmt.Errorf("%w: file %s", ErrDamaged, f.ID)
	}
	return f, data, nil
}

// SetHold is Legal Hold: no shredding or removal until the day after until;
// nil until clears it. Each change is recorded with its day and reason.
func (s *Service) SetHold(ctx context.Context, reader Reader, id uuid.UUID, until *string, reason string) (Document, error) {
	if _, _, err := s.manageable(ctx, reader, id); err != nil {
		return Document{}, err
	}
	reason = strings.TrimSpace(reason)
	if until != nil {
		day, err := time.Parse(time.DateOnly, *until)
		if err != nil {
			return Document{}, fieldError("hold_until", "is not a date (YYYY-MM-DD)")
		}
		if day.Format(time.DateOnly) < s.today() {
			return Document{}, fieldError("hold_until", "is in the past")
		}
		if reason == "" {
			return Document{}, fieldError("hold_reason", "is required")
		}
		if utf8.RuneCountInString(reason) > 500 {
			return Document{}, fieldError("hold_reason", "is too long")
		}
	}
	d, err := s.repo.Update(ctx, id, func(cur Document) (Change, error) {
		next := cur
		var ev audit.Event
		var err error
		now := s.now()
		switch {
		case until == nil && cur.HoldUntil == nil:
			return Change{Document: cur, Links: cur.Links}, nil
		case until == nil:
			next.HoldUntil, next.HoldReason = nil, nil
			ev, err = s.event(reader.ID, EventHoldCleared, id, now, map[string]any{"hold_until": cur.HoldUntil, "hold_reason": cur.HoldReason}, nil)
		default:
			if cur.HoldUntil != nil && *cur.HoldUntil == *until && cur.HoldReason != nil && *cur.HoldReason == reason {
				return Change{Document: cur, Links: cur.Links}, nil
			}
			next.HoldUntil, next.HoldReason = until, &reason
			ev, err = s.event(reader.ID, EventHoldSet, id, now, map[string]any{"hold_until": cur.HoldUntil, "hold_reason": cur.HoldReason},
				map[string]any{"hold_until": until, "hold_reason": reason})
		}
		if err != nil {
			return Change{}, err
		}
		next.UpdatedAt, next.UpdatedByUserID = now, reader.ID
		return Change{Document: next, Links: cur.Links, Events: []audit.Event{ev}}, nil
	})
	if err != nil {
		return Document{}, err
	}
	return d, s.unseal(&d)
}

// dueDay is when the retention rule of a sealed document's type removes it,
// or nil when it cannot be known (still employed, no date) or never.
func (s *Service) dueDay(ctx context.Context, c Candidate) (*string, error) {
	t, ok := vault.TypeOf(c.Type)
	if !ok {
		return nil, nil
	}
	add := func(day string) (*string, error) {
		at, err := time.Parse(time.DateOnly, day)
		if err != nil {
			return nil, err
		}
		due := at.AddDate(0, t.Retention.Months, 0).Format(time.DateOnly)
		return &due, nil
	}
	switch t.Retention.Rule {
	case vault.AfterDocDate:
		if c.DocumentDate == nil {
			return nil, nil
		}
		return add(*c.DocumentDate)
	case vault.AfterEmploymentEnd:
		if s.employments == nil || len(c.Employees) == 0 {
			return nil, nil
		}
		last := ""
		for _, e := range c.Employees {
			ended, on, err := s.employments.EmploymentEnded(ctx, e)
			if err != nil {
				return nil, err
			}
			if !ended {
				return nil, nil
			}
			last = max(last, on)
		}
		return add(last)
	}
	return nil, nil
}

// Shredded is what ShredDue did.
type Shredded struct {
	Documents int
	// Failed are the documents or objects that could not be shredded or deleted; the log names them.
	Failed int
}

// ShredDue applies the sealed types' retention, for the upkeep: each sealed
// document's retain_until is computed again, and one past it, or removed,
// is shredded unless held (vault.document_shredded, by no one), then its
// files deleted from the store. A rule, not an action: after a restore it
// shreds again.
func (s *Service) ShredDue(ctx context.Context, logger *slog.Logger) (Shredded, error) {
	var out Shredded
	cands, err := s.repo.Sealed(ctx)
	if err != nil {
		return out, err
	}
	today := s.today()
	for _, c := range cands {
		due, err := s.dueDay(ctx, c)
		if err != nil {
			out.Failed++
			logger.Error("vault retention failed", slog.String("document", c.ID.String()), slog.Any("error", err))
			continue
		}
		if !sameDate(due, c.RetainUntil) {
			if err := s.repo.SetRetainUntil(ctx, c.ID, due); err != nil {
				return out, err
			}
		}
		if !c.Removed && (due == nil || *due > today) {
			continue
		}
		if c.HoldUntil != nil && *c.HoldUntil >= today {
			continue
		}
		ev, err := audit.New(s.newID(), nil, EventShredded, Entity, c.ID, s.now(), nil, map[string]any{
			"type": c.Type, "number": c.Number, "document_date": c.DocumentDate, "retain_until": due, "removed": c.Removed,
		})
		if err != nil {
			return out, err
		}
		keys, err := s.repo.Shred(ctx, c.ID, s.now(), today, ev)
		if err != nil {
			out.Failed++
			logger.Error("vault shredding failed", slog.String("document", c.ID.String()), slog.Any("error", err))
			continue
		}
		out.Documents++
		if s.store == nil {
			continue
		}
		for _, k := range keys {
			if err := s.store.Delete(ctx, k); err != nil && !errors.Is(err, files.ErrNotFound) {
				out.Failed++
				logger.Error("vault shredded file not deleted", slog.String("document", c.ID.String()), slog.Any("error", err))
			}
		}
	}
	return out, nil
}
