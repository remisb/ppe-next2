package employeephoto

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"path"
	"slices"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
)

// Audit event names. They are written on the employee, so they show in the
// employee's Changes.
const (
	EventAdded          = "employee.photo_added"
	EventUsesChanged    = "employee.photo_uses_changed"
	EventDefaultChanged = "employee.photo_default_changed"
	EventRemoved        = "employee.photo_removed"
	auditEntity         = "employee"
)

type Service struct {
	repo  Repository
	files files.Store
	now   func() time.Time
	newID func() uuid.UUID
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// WithFiles sets where photos are kept. Without it, uploads are ErrNoStorage.
func WithFiles(store files.Store) Option { return func(s *Service) { s.files = store } }

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

func (s *Service) event(actor uuid.UUID, name string, employeeID uuid.UUID, at time.Time, after any) (audit.Event, error) {
	return audit.New(s.newID(), &actor, name, auditEntity, employeeID, at, nil, after)
}

// List is the employee's photos, the default first.
func (s *Service) List(ctx context.Context, employeeID uuid.UUID) ([]Photo, error) {
	ps, err := s.repo.List(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	slices.SortStableFunc(ps, func(a, b Photo) int {
		switch {
		case a.IsDefault && !b.IsDefault:
			return -1
		case b.IsDefault && !a.IsDefault:
			return 1
		}
		return 0
	})
	return ps, nil
}

// Add keeps a JPEG or PNG of the employee, at most 10 MB, its metadata removed
// but for which way up it is. The employee's first photo becomes the default.
// The file is stored first, then its row and event, so a row never names a
// file that is not there.
func (s *Service) Add(ctx context.Context, employeeID uuid.UUID, u Upload, usesIn []string, actor uuid.UUID) (Photo, error) {
	if actor == uuid.Nil {
		return Photo{}, fieldError("actor", "is required")
	}
	if s.files == nil {
		return Photo{}, ErrNoStorage
	}
	uses, err := NormalizeUses(usesIn)
	if err != nil {
		return Photo{}, err
	}
	if len(u.Data) == 0 {
		return Photo{}, fieldError("file", "is empty")
	}
	if len(u.Data) > MaxBytes {
		return Photo{}, ErrFileTooLarge
	}
	contentType := files.Sniff(u.Data)
	if contentType != files.JPEG && contentType != files.PNG {
		return Photo{}, ErrFileType
	}
	data, err := files.Clean(contentType, u.Data)
	if err != nil {
		return Photo{}, fieldError("file", "is damaged")
	}
	// The employee first, so no file is stored for one that is not there.
	if _, err := s.repo.List(ctx, employeeID); err != nil {
		return Photo{}, err
	}
	sum := sha256.Sum256(data)
	p := Photo{
		ID: s.newID(), EmployeeID: employeeID, FileName: photoName(u.FileName, contentType), ContentType: contentType,
		SizeBytes: int64(len(data)), SHA256: hex.EncodeToString(sum[:]), Uses: uses, UploadedAt: s.now(), UploadedByUserID: actor,
	}
	p.ObjectKey = "employee-photos/" + employeeID.String() + "/" + p.ID.String() + files.Ext(contentType)
	if err := s.files.Put(ctx, p.ObjectKey, bytes.NewReader(data), p.SizeBytes, contentType); err != nil {
		return Photo{}, fmt.Errorf("employeephoto: storing photo: %w", err)
	}
	err = s.repo.Apply(ctx, employeeID, func(cur []Photo) ([]Photo, []audit.Event, error) {
		p.IsDefault = len(cur) == 0
		evs := make([]audit.Event, 0, 2)
		ev, err := s.event(actor, EventAdded, employeeID, p.UploadedAt, photoFacts(p))
		if err != nil {
			return nil, nil, err
		}
		evs = append(evs, ev)
		if p.IsDefault {
			if ev, err = s.event(actor, EventDefaultChanged, employeeID, p.UploadedAt, map[string]any{"photo_id": p.ID}); err != nil {
				return nil, nil, err
			}
			evs = append(evs, ev)
		}
		return []Photo{p}, evs, nil
	})
	if err != nil {
		return Photo{}, err
	}
	return p, nil
}

// SetUses replaces the uses a photo serves; none clears them.
func (s *Service) SetUses(ctx context.Context, employeeID, photoID uuid.UUID, usesIn []string, actor uuid.UUID) (Photo, error) {
	if actor == uuid.Nil {
		return Photo{}, fieldError("actor", "is required")
	}
	uses, err := NormalizeUses(usesIn)
	if err != nil {
		return Photo{}, err
	}
	var out Photo
	err = s.repo.Apply(ctx, employeeID, func(cur []Photo) ([]Photo, []audit.Event, error) {
		i := indexOf(cur, photoID)
		if i < 0 {
			return nil, nil, ErrNotFound
		}
		out = cur[i]
		if slices.Equal(out.Uses, uses) {
			return nil, nil, nil
		}
		before := out.Uses
		out.Uses = uses
		ev, err := audit.New(s.newID(), &actor, EventUsesChanged, auditEntity, employeeID, s.now(),
			map[string]any{"photo_id": photoID, "uses": before}, map[string]any{"photo_id": photoID, "uses": uses})
		return []Photo{out}, []audit.Event{ev}, err
	})
	return out, err
}

// SetDefault makes the photo the employee's default; the previous default stops being one.
func (s *Service) SetDefault(ctx context.Context, employeeID, photoID, actor uuid.UUID) (Photo, error) {
	if actor == uuid.Nil {
		return Photo{}, fieldError("actor", "is required")
	}
	var out Photo
	err := s.repo.Apply(ctx, employeeID, func(cur []Photo) ([]Photo, []audit.Event, error) {
		i := indexOf(cur, photoID)
		if i < 0 {
			return nil, nil, ErrNotFound
		}
		out = cur[i]
		if out.IsDefault {
			return nil, nil, nil
		}
		next := make([]Photo, 0, 2)
		for _, p := range cur {
			if p.IsDefault {
				p.IsDefault = false
				next = append(next, p)
			}
		}
		out.IsDefault = true
		next = append(next, out)
		ev, err := s.event(actor, EventDefaultChanged, employeeID, s.now(), map[string]any{"photo_id": photoID})
		return next, []audit.Event{ev}, err
	})
	return out, err
}

// Remove takes a photo away. When it was the default, the employee's oldest
// remaining photo becomes the default. The file stays in the store.
func (s *Service) Remove(ctx context.Context, employeeID, photoID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	return s.repo.Apply(ctx, employeeID, func(cur []Photo) ([]Photo, []audit.Event, error) {
		i := indexOf(cur, photoID)
		if i < 0 {
			return nil, nil, ErrNotFound
		}
		at := s.now()
		gone := cur[i]
		wasDefault := gone.IsDefault
		gone.IsDefault, gone.DeletedAt, gone.DeletedByUserID = false, &at, &actor
		next := []Photo{gone}
		ev, err := s.event(actor, EventRemoved, employeeID, at, photoFacts(cur[i]))
		if err != nil {
			return nil, nil, err
		}
		evs := []audit.Event{ev}
		if wasDefault {
			for _, p := range cur {
				if p.ID == photoID {
					continue
				}
				p.IsDefault = true
				next = append(next, p)
				if ev, err = s.event(actor, EventDefaultChanged, employeeID, at, map[string]any{"photo_id": p.ID}); err != nil {
					return nil, nil, err
				}
				evs = append(evs, ev)
				break
			}
		}
		return next, evs, nil
	})
}

// Open opens one photo's file, for display.
func (s *Service) Open(ctx context.Context, employeeID, photoID uuid.UUID) (Photo, io.ReadCloser, error) {
	if s.files == nil {
		return Photo{}, nil, ErrNoStorage
	}
	p, err := s.repo.Photo(ctx, employeeID, photoID)
	if err != nil {
		return Photo{}, nil, err
	}
	r, err := s.files.Get(ctx, p.ObjectKey)
	if err != nil {
		// A row without its file is the store's loss, not the user's mistake.
		return Photo{}, nil, fmt.Errorf("employeephoto: photo %s: %w", p.ID, err)
	}
	return p, r, nil
}

func indexOf(ps []Photo, id uuid.UUID) int {
	return slices.IndexFunc(ps, func(p Photo) bool { return p.ID == id })
}

func photoFacts(p Photo) map[string]any {
	return map[string]any{"photo_id": p.ID, "file_name": p.FileName, "content_type": p.ContentType,
		"size_bytes": p.SizeBytes, "sha256": p.SHA256, "uses": p.Uses}
}

// photoName is the name a photo is listed under: the device's name without its
// folder or odd characters, with the extension of what the file really is.
func photoName(name, contentType string) string {
	base := strings.TrimSuffix(path.Base(strings.ReplaceAll(name, `\`, "/")), path.Ext(name))
	var b strings.Builder
	for _, r := range base {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' || r == '.':
			b.WriteRune(r)
		case unicode.IsSpace(r):
			b.WriteRune(' ')
		}
	}
	clean := strings.TrimSpace(b.String())
	if clean == "" || clean == "." {
		clean = "photo"
	}
	if r := []rune(clean); len(r) > 150 {
		clean = string(r[:150])
	}
	return clean + files.Ext(contentType)
}
