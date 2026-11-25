package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/vault"
)

// Archiving (phase 6; docs/specs/vault-service.md, "Archiving"): after Give
// stores an assignment form and after a confirmation gives an order, their
// domains ask for a copy (QueueArchives, after commit); the worker's
// vault.archive job asks the source's context for the record as a PDF
// (Records) and keeps it as an archived document of the source's type, one per
// record, linked (locked) as the source names it. The snapshot and its hash
// stay in the domain, which Verify asks again.

// KindArchive is the job that archives one record, keyed by its source kind
// and id.
const KindArchive = "vault.archive"

// EventArchived: a record archived as a document; its after is the type,
// number, document hash and the source's record. Recorded by the worker, so
// with no actor.
const EventArchived = "vault.document_archived"

// VersionArchived is an archived document's version (vault.versions.origin).
const VersionArchived = "archived"

// ArchiveJob is the job's payload: the source kind and its record's id.
type ArchiveJob struct {
	Source string    `json:"source"`
	ID     uuid.UUID `json:"id"`
}

// archiveFor is the job that archives source's record id.
func archiveFor(source string, id uuid.UUID) (kind, key string, payload ArchiveJob) {
	return KindArchive, source + ":" + id.String(), ArchiveJob{Source: source, ID: id}
}

// Record is a record of another context as the vault archives it: its PDF
// drawn from the stored snapshot, the snapshot's own document hash, what the
// document is called, its date and links, and who made the record and when.
type Record struct {
	Title        string
	Number       *string
	DocumentDate *string
	// Links are the record's subjects, named by its context; they are locked.
	Links    []Link
	FileName string
	PDF      []byte
	// DocumentHash is the hash the domain stored with the record (the form's,
	// the confirmation's); the PDF prints it.
	DocumentHash string
	// Actor made the record (gave the asset or the order); the document is theirs.
	Actor uuid.UUID
}

// Records is the port to the contexts whose records the vault archives,
// adapted in cmd/api/wire_vault.go, by source kind (vault.Type.Source).
type Records interface {
	// Record is source's record id as the vault keeps it; ErrNotFound when
	// there is nothing to archive (no such record, or none stored).
	Record(ctx context.Context, source string, id uuid.UUID) (Record, error)
	// Hash is the record's document hash computed again from its stored
	// snapshot, for Verify; ErrNotFound when the record is gone.
	Hash(ctx context.Context, source string, id uuid.UUID) (string, error)
	// Ended is the day source's record id ended, for retention (an
	// assignment's return; the end of an order's items' service period);
	// false while it has not, or the record is gone.
	Ended(ctx context.Context, source string, id uuid.UUID) (day string, ended bool, err error)
}

// WithRecords lets the service archive and verify records (the worker's, and
// the API's for Verify).
func WithRecords(r Records) Option { return func(s *Service) { s.records = r } }

// archiveType is the type whose documents source's records are archived as.
func archiveType(source string) (vault.Type, error) {
	for _, t := range vault.Types() {
		if t.Source == source && t.Allows(vault.Archived) {
			return t, nil
		}
	}
	return vault.Type{}, fmt.Errorf("vault: %q is not an archived source", source)
}

// QueueArchives queues the archiving of the records ids of the source of type
// key that have no document yet, and answers how many it queued (a record
// already waiting for its job is not queued twice). Domains call it after
// their commit, best effort; the upkeep's sweep and -vault-backfill with
// whatever they find.
func (s *Service) QueueArchives(ctx context.Context, key string, ids []uuid.UUID) (int64, error) {
	t, err := sourceOf(key)
	if err != nil || !t.Allows(vault.Archived) {
		return 0, fmt.Errorf("vault: %q is not an archived type", key)
	}
	if len(ids) == 0 {
		return 0, nil
	}
	return s.repo.QueueArchives(ctx, t.Source, ids, s.now())
}

// Unarchived are those of ids, records of the source of type key, that have
// no document yet.
func (s *Service) Unarchived(ctx context.Context, key string, ids []uuid.UUID) ([]uuid.UUID, error) {
	t, err := sourceOf(key)
	if err != nil || !t.Allows(vault.Archived) {
		return nil, fmt.Errorf("vault: %q is not an archived type", key)
	}
	if len(ids) == 0 {
		return []uuid.UUID{}, nil
	}
	return s.repo.Unarchived(ctx, t.Source, ids)
}

// Archive is the job: source's record id kept as a document, once. A record
// already archived, or with nothing to archive, is done; a PDF that is not one
// fails for good.
func (s *Service) Archive(ctx context.Context, source string, id uuid.UUID) error {
	if s.records == nil {
		return errors.New("vault: no records to archive from")
	}
	if s.store == nil {
		return ErrNoStorage
	}
	t, err := archiveType(source)
	if err != nil {
		return err
	}
	if _, err := s.repo.SourceDocument(ctx, source, id); err == nil {
		return nil
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}
	rec, err := s.records.Record(ctx, source, id)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if rec.Actor == uuid.Nil {
		return fieldError("record", "has no actor")
	}
	if !hexHash.MatchString(rec.DocumentHash) {
		return fieldError("record", "has no document hash")
	}
	refs := make([]LinkRef, len(rec.Links))
	links := make([]Link, len(rec.Links))
	for i, l := range rec.Links {
		refs[i] = LinkRef{Kind: l.Kind, ID: l.ID}
		l.Locked = true
		links[i] = l
	}
	p := Details{Title: rec.Title, DocumentDate: rec.DocumentDate, Links: refs}
	if err := p.Validate(t); err != nil {
		return err
	}
	if files.Sniff(rec.PDF) != files.PDF || int64(len(rec.PDF)) > t.MaxBytes {
		return fieldError("record", "is not a PDF within the type's size")
	}
	now := s.now()
	docID := s.newID()
	sum := sha256.Sum256(rec.PDF)
	f := File{
		ID: s.newID(), FileName: files.Name(rec.FileName, files.PDF, "record"), ContentType: files.PDF,
		SizeBytes: int64(len(rec.PDF)), SHA256: hex.EncodeToString(sum[:]),
	}
	f.ObjectKey = "vault/" + docID.String() + "/" + f.ID.String() + ".pdf"
	src := source
	d := Document{
		ID: docID, Type: t.Key, Title: p.Title, Number: rec.Number, DocumentDate: p.DocumentDate, Origin: vault.Archived,
		SourceKind: &src, SourceID: &id, Requires: requires(t, links), Links: links,
		CreatedAt: now, CreatedByUserID: rec.Actor, UpdatedAt: now, UpdatedByUserID: rec.Actor,
	}
	if err := s.store.Put(ctx, f.ObjectKey, bytes.NewReader(rec.PDF), f.SizeBytes, files.PDF); err != nil {
		return fmt.Errorf("vault: storing file: %w", err)
	}
	_, err = s.repo.AddSourced(ctx, d, func(cur Document) (Version, []audit.Event, error) {
		if cur.ID != docID || len(cur.Versions) > 0 {
			// Archived meanwhile (a second job for the record): nothing to add.
			return Version{}, nil, errArchived
		}
		ev, err := audit.New(s.newID(), nil, EventArchived, Entity, docID, now, nil, map[string]any{
			"type": t.Key, "number": rec.Number, "sha256": rec.DocumentHash, "source": source, "source_id": id,
			"links": linksJSON(links),
		})
		v := Version{ID: s.newID(), Number: 1, Origin: VersionArchived, DocumentHash: rec.DocumentHash, File: f,
			CreatedAt: now, CreatedByUserID: rec.Actor}
		return v, []audit.Event{ev}, err
	})
	if errors.Is(err, errArchived) {
		return nil
	}
	return err
}

// hexHash is a SHA-256 in hex, as vault.versions.document_hash holds it.
var hexHash = regexp.MustCompile(`^[0-9a-f]{64}$`)

// errArchived: the record has its document already.
var errArchived = errors.New("vault: the record is archived already")

// linksJSON are links as events record them.
func linksJSON(links []Link) []map[string]any {
	out := make([]map[string]any, len(links))
	for i, l := range links {
		out[i] = linkJSON(l)
	}
	return out
}

// Verification is an archived document checked against its source.
type Verification struct {
	// DocumentHash is the archived version's; SourceHash the record's,
	// computed again now from its stored snapshot ("" when the record is gone).
	DocumentHash string `json:"document_hash"`
	SourceHash   string `json:"source_hash"`
	// Matches: the two are the same. FileIntact: the archived file's bytes
	// still hash to what was stored.
	Matches    bool      `json:"matches"`
	FileIntact bool      `json:"file_intact"`
	SourceGone bool      `json:"source_gone"`
	CheckedAt  time.Time `json:"checked_at"`
}

// Verify checks archived document id, which reader may see: its file against
// its hash, and its document hash against the source's snapshot hashed again.
func (s *Service) Verify(ctx context.Context, reader Reader, id uuid.UUID) (Verification, error) {
	if s.records == nil || s.store == nil {
		return Verification{}, ErrNoStorage
	}
	d, err := s.Get(ctx, reader, id)
	if err != nil {
		return Verification{}, err
	}
	if d.Origin != vault.Archived || d.SourceKind == nil || d.SourceID == nil || len(d.Versions) == 0 {
		return Verification{}, fieldError("document", "is not archived")
	}
	i := slices.IndexFunc(d.Versions, func(v Version) bool { return v.Origin == VersionArchived })
	if i < 0 {
		return Verification{}, fieldError("document", "is not archived")
	}
	v := d.Versions[i]
	out := Verification{DocumentHash: v.DocumentHash, CheckedAt: s.now()}
	// A file missing from the store, or changed, is not intact.
	if _, err := s.fileBytes(ctx, d, v.File); err == nil {
		out.FileIntact = true
	} else if !errors.Is(err, ErrDamaged) && !errors.Is(err, files.ErrNotFound) {
		return Verification{}, err
	}
	out.SourceHash, err = s.records.Hash(ctx, *d.SourceKind, *d.SourceID)
	switch {
	case errors.Is(err, ErrNotFound):
		out.SourceGone = true
	case err != nil:
		return Verification{}, err
	}
	out.Matches = out.SourceHash != "" && out.SourceHash == out.DocumentHash
	return out, nil
}
