package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/sealbox"
	"github.com/remisb/ppe-next2/internal/vault"
)

// The vault's audit events (docs/specs/vault-service.md, "Audit events").
const (
	// EventUploaded: a new document from a file; its after is the type, title,
	// file and links.
	EventUploaded = "vault.document_uploaded"
	// EventVersionAdded: a newer file of a document.
	EventVersionAdded = "vault.version_added"
	// EventUpdated: the title or dates changed, before and after.
	EventUpdated = "vault.document_updated"
	// EventLinked and EventUnlinked: a link added or removed, with its kind, id and label.
	EventLinked   = "vault.document_linked"
	EventUnlinked = "vault.document_unlinked"
	// EventRemoved: a soft delete; its before is the type and title.
	EventRemoved = "vault.document_removed"
	// Entity is the audit entity type of a document, keyed by its id.
	Entity = "vault_document"
)

// Events are every event this package writes, for the audit registry's test.
func Events() []string {
	return []string{EventUploaded, EventVersionAdded, EventUpdated, EventLinked, EventUnlinked, EventRemoved,
		EventOpened, EventHoldSet, EventHoldCleared, EventShredded, EventGenerated}
}

// SubjectInfo is what the vault learns of a subject: its name, and the
// permissions a reader needs to see it (an equipment item's equipment.read).
type SubjectInfo struct {
	Label    string
	Requires []string
}

// Subjects is the port to the contexts documents link to, adapted in
// cmd/api/wire_vault.go. Describe answers ErrSubjectNotFound for a subject
// that does not exist (or is deleted).
type Subjects interface {
	Describe(ctx context.Context, kind vault.SubjectKind, id uuid.UUID) (SubjectInfo, error)
}

// Reader is who asks: the user and the permissions their token grants.
type Reader struct {
	ID    uuid.UUID
	Perms []string
}

func (r Reader) holds(p string) bool { return slices.Contains(r.Perms, p) }

func (r Reader) holdsAll(ps []string) bool {
	for _, p := range ps {
		if !r.holds(p) {
			return false
		}
	}
	return true
}

// Upload is a file to keep: its name on the device and its bytes.
type Upload struct {
	FileName string
	Data     []byte
	Note     string
}

// Service holds the documents' use cases.
type Service struct {
	repo        Repository
	subjects    Subjects
	store       files.Store
	keys        sealbox.Sealer
	employments Employments
	templates   Templates
	people      People
	users       Users
	loc         *time.Location
	now         func() time.Time
	newID       func() uuid.UUID
}

// Option configures a Service.
type Option func(*Service)

// WithClock replaces the clock (UTC, microseconds, as Postgres stores them).
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// WithFiles sets where files are kept. Without it, uploads and opening are ErrNoStorage.
func WithFiles(store files.Store) Option { return func(s *Service) { s.store = store } }

// NewService is the document service over repo, describing links through subjects.
func NewService(repo Repository, subjects Subjects, opts ...Option) *Service {
	s := &Service{repo: repo, subjects: subjects, loc: time.UTC, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Types are the types reader may see, each saying whether they may add one.
func (s *Service) Types(reader Reader) []vault.Type {
	out := make([]vault.Type, 0)
	for _, t := range vault.Types() {
		if reader.holds(t.Read) {
			out = append(out, t)
		}
	}
	return out
}

// event is an audit event on document id by actor.
func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) (audit.Event, error) {
	return audit.New(s.newID(), &actor, name, Entity, id, at, before, after)
}

// typeFor is key's type when reader may change its documents.
func typeFor(key string, reader Reader) (vault.Type, error) {
	t, ok := vault.TypeOf(key)
	if !ok || !reader.holds(t.Read) {
		return vault.Type{}, fieldError("type", "is not a document type")
	}
	if !reader.holds(t.Manage) {
		return vault.Type{}, ErrForbidden
	}
	return t, nil
}

// checkFile reads what u holds: its sniffed type, cleaned bytes and their hash.
func checkFile(t vault.Type, u Upload) (File, []byte, error) {
	if len(u.Data) == 0 {
		return File{}, nil, fieldError("file", "is empty")
	}
	if int64(len(u.Data)) > t.MaxBytes {
		return File{}, nil, ErrTooLarge
	}
	contentType := files.Sniff(u.Data)
	if contentType == "" || !slices.Contains(t.FileTypes, contentType) {
		return File{}, nil, ErrFileType
	}
	data, err := files.Clean(contentType, u.Data)
	if err != nil {
		return File{}, nil, fieldError("file", "is damaged")
	}
	sum := sha256.Sum256(data)
	return File{
		FileName: files.Name(u.FileName, contentType, "document"), ContentType: contentType,
		SizeBytes: int64(len(data)), SHA256: hex.EncodeToString(sum[:]),
	}, data, nil
}

// trimLines drops carriage returns and each line's trailing space, and the
// whole's leading and trailing space.
func trimLines(s string) string {
	lines := strings.Split(strings.ReplaceAll(s, "\r", ""), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t")
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// checkNote trims a version's note and checks its length.
func checkNote(note string) (string, error) {
	note = trimLines(note)
	if len([]rune(note)) > maxNoteLen {
		return "", fieldError("note", "is too long")
	}
	return note, nil
}

// links describes each ref, refusing one reader may not see, and keeps locked
// links of cur whatever refs say.
func (s *Service) links(ctx context.Context, reader Reader, refs []LinkRef, keep []Link) ([]Link, error) {
	out := slices.Clone(keep)
	for _, ref := range refs {
		if slices.ContainsFunc(out, func(l Link) bool { return l.Kind == ref.Kind && l.ID == ref.ID }) {
			continue
		}
		info, err := s.subjects.Describe(ctx, ref.Kind, ref.ID)
		if errors.Is(err, ErrSubjectNotFound) {
			return nil, fmt.Errorf("%w: %s %s", ErrSubjectNotFound, ref.Kind, ref.ID)
		}
		if err != nil {
			return nil, err
		}
		if !reader.holdsAll(info.Requires) {
			return nil, fmt.Errorf("%w: %s %s", ErrSubjectNotFound, ref.Kind, ref.ID)
		}
		out = append(out, Link{Kind: ref.Kind, ID: ref.ID, Label: info.Label, Requires: slices.Clone(info.Requires)})
	}
	return out, nil
}

// requires is what a reader of a document of t linked to links needs: the
// type's read permission and every link's, sorted.
func requires(t vault.Type, links []Link) []string {
	out := []string{t.Read}
	for _, l := range links {
		for _, p := range l.Requires {
			if !slices.Contains(out, p) {
				out = append(out, p)
			}
		}
	}
	slices.Sort(out)
	return out
}

// linkJSON is a link as events record it.
func linkJSON(l Link) map[string]any {
	return map[string]any{"kind": l.Kind, "id": l.ID, "label": l.Label}
}

// Upload is Upload Document…: a new document of p's type from u, stored
// first, then its rows and vault.document_uploaded.
func (s *Service) Upload(ctx context.Context, reader Reader, typeKey string, p Details, u Upload) (Document, error) {
	if reader.ID == uuid.Nil {
		return Document{}, fieldError("actor", "is required")
	}
	if s.store == nil {
		return Document{}, ErrNoStorage
	}
	t, err := typeFor(typeKey, reader)
	if err != nil {
		return Document{}, err
	}
	if !t.Allows(vault.Uploaded) {
		return Document{}, fieldError("type", "is not uploaded")
	}
	if t.Sealed && s.keys == nil {
		return Document{}, ErrNotConfigured
	}
	if err := p.Validate(t); err != nil {
		return Document{}, err
	}
	note, err := checkNote(u.Note)
	if err != nil {
		return Document{}, err
	}
	f, data, err := checkFile(t, u)
	if err != nil {
		return Document{}, err
	}
	links, err := s.links(ctx, reader, p.Links, nil)
	if err != nil {
		return Document{}, err
	}
	now := s.now()
	d := Document{
		ID: s.newID(), Type: t.Key, Title: p.Title, DocumentDate: p.DocumentDate, ValidFrom: p.ValidFrom, ValidUntil: p.ValidUntil,
		Origin: vault.Uploaded, Requires: requires(t, links), Links: links,
		CreatedAt: now, CreatedByUserID: reader.ID, UpdatedAt: now, UpdatedByUserID: reader.ID,
	}
	f.ID = s.newID()
	f.ObjectKey = "vault/" + d.ID.String() + "/" + f.ID.String() + files.Ext(f.ContentType)
	v := Version{
		ID: s.newID(), Number: 1, Origin: VersionOriginal, DocumentHash: f.SHA256, Note: note, File: f,
		CreatedAt: now, CreatedByUserID: reader.ID,
	}
	ls := make([]map[string]any, len(links))
	for i, l := range links {
		ls[i] = linkJSON(l)
	}
	after := map[string]any{"type": d.Type, "content_type": f.ContentType, "size_bytes": f.SizeBytes, "sha256": f.SHA256, "links": ls}
	if t.Sealed {
		// Sealed: the title, file name and note under a key of the document's own; no title or name in the event.
		box, key, keyID, err := s.newKey(d.ID)
		if err != nil {
			return Document{}, err
		}
		d.Sealed, d.Key, d.KeyID = true, key, keyID
		if d.TitleSealed, err = box.Seal([]byte(d.Title), titleContext(d.ID)); err != nil {
			return Document{}, err
		}
		d.Title = ""
		if data, err = sealVersion(box, &v, data); err != nil {
			return Document{}, err
		}
		f = v.File
	} else {
		after["title"], after["file_name"] = d.Title, f.FileName
	}
	d.Versions = []Version{v}
	ev, err := s.event(reader.ID, EventUploaded, d.ID, now, nil, after)
	if err != nil {
		return Document{}, err
	}
	// The file first, so a row never names a missing file.
	if err := s.store.Put(ctx, f.ObjectKey, bytes.NewReader(data), int64(len(data)), f.ContentType); err != nil {
		return Document{}, fmt.Errorf("vault: storing file: %w", err)
	}
	if err := s.repo.Create(ctx, d, links, ev); err != nil {
		return Document{}, err
	}
	out, err := s.repo.Get(ctx, d.ID)
	if err != nil {
		return Document{}, err
	}
	return out, s.unseal(&out)
}

// Get is the document when reader may see it, else ErrNotFound.
func (s *Service) Get(ctx context.Context, reader Reader, id uuid.UUID) (Document, error) {
	d, err := s.repo.Get(ctx, id)
	if err != nil {
		return Document{}, err
	}
	if !reader.holdsAll(d.Requires) {
		return Document{}, ErrNotFound
	}
	return d, s.unseal(&d)
}

// manageable is the live document and its type when reader may change it.
func (s *Service) manageable(ctx context.Context, reader Reader, id uuid.UUID) (Document, vault.Type, error) {
	if reader.ID == uuid.Nil {
		return Document{}, vault.Type{}, fieldError("actor", "is required")
	}
	d, err := s.Get(ctx, reader, id)
	if err != nil {
		return Document{}, vault.Type{}, err
	}
	t, ok := vault.TypeOf(d.Type)
	if !ok {
		return Document{}, vault.Type{}, ErrNotFound
	}
	if !reader.holds(t.Manage) {
		return Document{}, vault.Type{}, ErrForbidden
	}
	return d, t, nil
}

// AddVersion is Add Version: a newer file of the document, with vault.version_added.
func (s *Service) AddVersion(ctx context.Context, reader Reader, id uuid.UUID, u Upload) (Document, error) {
	if s.store == nil {
		return Document{}, ErrNoStorage
	}
	d, t, err := s.manageable(ctx, reader, id)
	if err != nil {
		return Document{}, err
	}
	if d.Locked {
		return Document{}, ErrLocked
	}
	note, err := checkNote(u.Note)
	if err != nil {
		return Document{}, err
	}
	f, data, err := checkFile(t, u)
	if err != nil {
		return Document{}, err
	}
	f.ID = s.newID()
	f.ObjectKey = "vault/" + d.ID.String() + "/" + f.ID.String() + files.Ext(f.ContentType)
	v := Version{ID: s.newID(), Origin: VersionAdded, DocumentHash: f.SHA256, Note: note, File: f, CreatedByUserID: reader.ID}
	after := map[string]any{"origin": v.Origin, "content_type": f.ContentType, "size_bytes": f.SizeBytes, "sha256": f.SHA256}
	if d.Sealed {
		box, err := s.openKey(d)
		if err != nil {
			return Document{}, err
		}
		if data, err = sealVersion(box, &v, data); err != nil {
			return Document{}, err
		}
	} else {
		after["file_name"] = f.FileName
	}
	if err := s.store.Put(ctx, v.File.ObjectKey, bytes.NewReader(data), int64(len(data)), f.ContentType); err != nil {
		return Document{}, fmt.Errorf("vault: storing file: %w", err)
	}
	out, err := s.repo.AddVersion(ctx, id, func(cur Document) (Version, []audit.Event, error) {
		v.Number, v.CreatedAt = cur.Current().Number+1, s.now()
		after["number"] = v.Number
		ev, err := s.event(reader.ID, EventVersionAdded, id, v.CreatedAt, nil, after)
		return v, []audit.Event{ev}, err
	})
	if err != nil {
		return Document{}, err
	}
	return out, s.unseal(&out)
}

// fields are a document's editable fields as events record them.
func fields(d Document) map[string]any {
	return map[string]any{"title": d.Title, "document_date": d.DocumentDate, "valid_from": d.ValidFrom, "valid_until": d.ValidUntil}
}

func sameDate(a, b *string) bool { return (a == nil) == (b == nil) && (a == nil || *a == *b) }

// Update replaces the title, dates and the links that are not locked,
// recording vault.document_updated with the changed fields and a
// vault.document_linked or _unlinked per link; nothing changed records nothing.
func (s *Service) Update(ctx context.Context, reader Reader, id uuid.UUID, p Details) (Document, error) {
	d, t, err := s.manageable(ctx, reader, id)
	if err != nil {
		return Document{}, err
	}
	for _, l := range d.Links {
		if l.Locked {
			p.Links = append(p.Links, LinkRef{Kind: l.Kind, ID: l.ID})
		}
	}
	if err := p.Validate(t); err != nil {
		return Document{}, err
	}
	// Links already there keep their name; new ones are described.
	var kept []Link
	for _, l := range d.Links {
		if slices.ContainsFunc(p.Links, func(r LinkRef) bool { return r.Kind == l.Kind && r.ID == l.ID }) {
			kept = append(kept, l)
		}
	}
	links, err := s.links(ctx, reader, p.Links, kept)
	if err != nil {
		return Document{}, err
	}
	var box *sealbox.Box
	if d.Sealed {
		if box, err = s.openKey(d); err != nil {
			return Document{}, err
		}
	}
	out, err := s.repo.Update(ctx, id, func(cur Document) (Change, error) {
		next := cur
		if cur.Sealed {
			// The title as it is, to compare; only a changed one is sealed again.
			cur.Title = d.Title
		}
		next.Title, next.DocumentDate, next.ValidFrom, next.ValidUntil = p.Title, p.DocumentDate, p.ValidFrom, p.ValidUntil
		next.Requires = requires(t, links)
		now := s.now()
		var evs []audit.Event
		before, after := map[string]any{}, map[string]any{}
		was, is := fields(cur), fields(next)
		if cur.Title != next.Title {
			if cur.Sealed {
				// A sealed title's words stay out of the trail.
				after["title_changed"] = true
				sealed, err := box.Seal([]byte(next.Title), titleContext(cur.ID))
				if err != nil {
					return Change{}, err
				}
				next.TitleSealed = sealed
			} else {
				before["title"], after["title"] = was["title"], is["title"]
			}
		}
		if cur.Sealed {
			next.Title = ""
		}
		for _, k := range []string{"document_date", "valid_from", "valid_until"} {
			if !sameDate(was[k].(*string), is[k].(*string)) {
				before[k], after[k] = was[k], is[k]
			}
		}
		if len(after) > 0 {
			ev, err := s.event(reader.ID, EventUpdated, id, now, before, after)
			if err != nil {
				return Change{}, err
			}
			evs = append(evs, ev)
		}
		for _, l := range cur.Links {
			if !slices.ContainsFunc(links, func(n Link) bool { return n.Kind == l.Kind && n.ID == l.ID }) {
				ev, err := s.event(reader.ID, EventUnlinked, id, now, map[string]any{"links": []map[string]any{linkJSON(l)}}, nil)
				if err != nil {
					return Change{}, err
				}
				evs = append(evs, ev)
			}
		}
		for _, l := range links {
			if !slices.ContainsFunc(cur.Links, func(c Link) bool { return c.Kind == l.Kind && c.ID == l.ID }) {
				ev, err := s.event(reader.ID, EventLinked, id, now, nil, map[string]any{"links": []map[string]any{linkJSON(l)}})
				if err != nil {
					return Change{}, err
				}
				evs = append(evs, ev)
			}
		}
		if len(evs) > 0 {
			next.UpdatedAt, next.UpdatedByUserID = now, reader.ID
		}
		return Change{Document: next, Links: links, Events: evs}, nil
	})
	if err != nil {
		return Document{}, err
	}
	return out, s.unseal(&out)
}

// Remove soft-deletes the document with vault.document_removed. A locked
// document is its source's and is not removed (ErrLocked).
func (s *Service) Remove(ctx context.Context, reader Reader, id uuid.UUID) error {
	d, _, err := s.manageable(ctx, reader, id)
	if err != nil {
		return err
	}
	if d.Locked {
		return ErrLocked
	}
	if d.HoldUntil != nil && *d.HoldUntil >= s.today() {
		return ErrHeld
	}
	_, err = s.repo.Update(ctx, id, func(cur Document) (Change, error) {
		now := s.now()
		next := cur
		next.DeletedAt, next.DeletedByUserID = &now, &reader.ID
		next.UpdatedAt, next.UpdatedByUserID = now, reader.ID
		before := map[string]any{"type": cur.Type, "title": cur.Title}
		if cur.Sealed {
			before = map[string]any{"type": cur.Type, "number": cur.Number}
		}
		ev, err := s.event(reader.ID, EventRemoved, id, now, before, nil)
		if err != nil {
			return Change{}, err
		}
		return Change{Document: next, Links: cur.Links, Events: []audit.Event{ev}}, nil
	})
	return err
}

// Open is version n's main file of a document reader may see, its bytes
// checked against the hash taken when it was stored (ErrDamaged).
func (s *Service) Open(ctx context.Context, reader Reader, id uuid.UUID, n int) (File, []byte, error) {
	if s.store == nil {
		return File{}, nil, ErrNoStorage
	}
	d, err := s.Get(ctx, reader, id)
	if err != nil {
		return File{}, nil, err
	}
	if d.Sealed {
		return File{}, nil, ErrSealed
	}
	i := slices.IndexFunc(d.Versions, func(v Version) bool { return v.Number == n })
	if i < 0 {
		return File{}, nil, ErrNotFound
	}
	f := d.Versions[i].File
	r, err := s.store.Get(ctx, f.ObjectKey)
	if err != nil {
		// A row without its file is the store's loss, not the user's mistake.
		return File{}, nil, fmt.Errorf("vault: file %s: %w", f.ID, err)
	}
	defer r.Close()
	data, err := io.ReadAll(r)
	if err != nil {
		return File{}, nil, fmt.Errorf("vault: reading file %s: %w", f.ID, err)
	}
	if sum := sha256.Sum256(data); hex.EncodeToString(sum[:]) != f.SHA256 {
		return File{}, nil, fmt.Errorf("%w: file %s", ErrDamaged, f.ID)
	}
	return f, data, nil
}

// Search is a page of the documents reader may see, matching q.
func (s *Service) Search(ctx context.Context, reader Reader, q Query) (Page, error) {
	if q.Page < 1 {
		q.Page = 1
	}
	if len(q.Types) > 20 {
		return Page{}, fieldError("types", "are too many")
	}
	if len([]rune(q.Words)) > 200 {
		return Page{}, fieldError("query", "is too long")
	}
	if q.Subject != nil && q.Subject.ID == uuid.Nil {
		return Page{}, fieldError("subject", "needs an id")
	}
	return s.repo.Search(ctx, q, reader.Perms)
}

// BySubject is every document reader may see that is linked to subject,
// newest first (at most a page).
func (s *Service) BySubject(ctx context.Context, reader Reader, subject LinkRef) ([]Hit, error) {
	p, err := s.Search(ctx, reader, Query{Subject: &subject, Page: 1})
	if err != nil {
		return nil, err
	}
	return p.Documents, nil
}

// RefreshLabels names every linked subject as it is called now (a renamed
// employee or asset), for the upkeep; it returns how many links changed. A
// subject that is gone keeps its last name.
func (s *Service) RefreshLabels(ctx context.Context) (int, error) {
	subjects, err := s.repo.Subjects(ctx)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, sub := range subjects {
		info, err := s.subjects.Describe(ctx, sub.Kind, sub.ID)
		if errors.Is(err, ErrSubjectNotFound) {
			continue
		}
		if err != nil {
			return n, err
		}
		changed, err := s.repo.Relabel(ctx, sub, info.Label)
		if err != nil {
			return n, err
		}
		n += changed
	}
	return n, nil
}
