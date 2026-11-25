package document

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/vault"
)

// Sourced documents belong to a record of another context, their source
// (vault.Type.Source): Company Assets' signed copies, one document per
// assignment, each upload a version (docs/specs/vault-service.md, "Signed
// copies"). The source adds them through its port, with its own permissions
// and its own audit event; no one changes them here (ErrLocked).

// Sourced is one file a source keeps: the document it belongs to (made with
// the first), the version's id, its bytes, and the source's event.
type Sourced struct {
	// Type is a type with a Source; SourceID the source's record.
	Type     string
	SourceID uuid.UUID
	// Title, DocumentDate and Links make the document with the first file;
	// the links are the source's, named by it, and locked.
	Title        string
	DocumentDate *string
	Links        []Link
	// FileID is the new version's id and its file's: the source's id for it.
	FileID uuid.UUID
	Upload Upload
	Actor  uuid.UUID
	// Event is the source's own audit event for the stored file, recorded in
	// the same transaction instead of one of the vault's.
	Event func(f SourcedFile) (audit.Event, error)
}

// SourcedFile is one version of a sourced document as its source sees it:
// its main file, when and by whom it was added.
type SourcedFile struct {
	SourceID uuid.UUID
	File
	CreatedAt       time.Time
	CreatedByUserID uuid.UUID
	CreatedByName   string
}

// errSourceRace: another request made the source's document first; AddSourced
// starts again under its id.
var errSourceRace = errors.New("vault: the source's document was made meanwhile")

// sourceOf is the source kind of type key's documents.
func sourceOf(key string) (vault.Type, error) {
	t, ok := vault.TypeOf(key)
	if !ok || t.Source == "" {
		return vault.Type{}, fmt.Errorf("vault: %q is not a sourced type", key)
	}
	return t, nil
}

// AddSourced keeps k's file as the next version of its source's document,
// making the document with the first one: the file is stored first, then the
// rows, the text to read and k's event in one transaction.
func (s *Service) AddSourced(ctx context.Context, k Sourced) (SourcedFile, error) {
	if s.store == nil {
		return SourcedFile{}, ErrNoStorage
	}
	if k.Actor == uuid.Nil || k.FileID == uuid.Nil || k.SourceID == uuid.Nil || k.Event == nil {
		return SourcedFile{}, fieldError("source", "is incomplete")
	}
	t, err := sourceOf(k.Type)
	if err != nil {
		return SourcedFile{}, err
	}
	refs := make([]LinkRef, len(k.Links))
	for i, l := range k.Links {
		refs[i] = LinkRef{Kind: l.Kind, ID: l.ID}
	}
	p := Details{Title: k.Title, DocumentDate: k.DocumentDate, Links: refs}
	if err := p.Validate(t); err != nil {
		return SourcedFile{}, err
	}
	f, data, err := checkFile(t, k.Upload)
	if err != nil {
		return SourcedFile{}, err
	}
	links := make([]Link, len(k.Links))
	for i, l := range k.Links {
		l.Locked = true
		links[i] = l
	}
	f.ID = k.FileID
	for range 2 {
		out, err := s.addSourced(ctx, t, k, p, links, f, data)
		if !errors.Is(err, errSourceRace) {
			return out, err
		}
	}
	return SourcedFile{}, errSourceRace
}

// addSourced is one try of AddSourced: the document the source has now, or a
// new one, its file stored under it.
func (s *Service) addSourced(ctx context.Context, t vault.Type, k Sourced, p Details, links []Link, f File, data []byte) (SourcedFile, error) {
	id, err := s.repo.SourceDocument(ctx, t.Source, k.SourceID)
	if errors.Is(err, ErrNotFound) {
		id, err = s.newID(), nil
	}
	if err != nil {
		return SourcedFile{}, err
	}
	now := s.now()
	source := t.Source
	d := Document{
		ID: id, Type: t.Key, Title: p.Title, DocumentDate: p.DocumentDate, Origin: vault.Uploaded,
		SourceKind: &source, SourceID: &k.SourceID, Requires: requires(t, links), Links: links,
		CreatedAt: now, CreatedByUserID: k.Actor, UpdatedAt: now, UpdatedByUserID: k.Actor,
	}
	f.ObjectKey = "vault/" + id.String() + "/" + f.ID.String() + files.Ext(f.ContentType)
	if err := s.store.Put(ctx, f.ObjectKey, bytes.NewReader(data), int64(len(data)), f.ContentType); err != nil {
		return SourcedFile{}, fmt.Errorf("vault: storing file: %w", err)
	}
	var out SourcedFile
	_, err = s.repo.AddSourced(ctx, d, func(cur Document) (Version, []audit.Event, error) {
		if cur.ID != id {
			return Version{}, nil, errSourceRace
		}
		v := Version{ID: f.ID, Number: cur.Current().Number + 1, Origin: VersionAdded, DocumentHash: f.SHA256, File: f,
			CreatedAt: now, CreatedByUserID: k.Actor}
		if v.Number == 1 {
			v.Origin = VersionOriginal
		}
		out = SourcedFile{SourceID: k.SourceID, File: f, CreatedAt: now, CreatedByUserID: k.Actor}
		ev, err := k.Event(out)
		return v, []audit.Event{ev}, err
	})
	if err != nil {
		return SourcedFile{}, err
	}
	// The name as reads give it.
	got, err := s.SourcedFiles(ctx, t.Key, []uuid.UUID{k.SourceID})
	if err != nil {
		return SourcedFile{}, err
	}
	if i := slices.IndexFunc(got[k.SourceID], func(g SourcedFile) bool { return g.ID == f.ID }); i >= 0 {
		return got[k.SourceID][i], nil
	}
	return out, nil
}

// SourcedFiles are the versions of the documents of type key whose sources
// are ids, by source, newest first; a source with none is left out.
func (s *Service) SourcedFiles(ctx context.Context, key string, ids []uuid.UUID) (map[uuid.UUID][]SourcedFile, error) {
	t, err := sourceOf(key)
	if err != nil {
		return nil, err
	}
	out := map[uuid.UUID][]SourcedFile{}
	if len(ids) == 0 {
		return out, nil
	}
	fs, err := s.repo.SourcedFiles(ctx, t.Source, ids)
	if err != nil {
		return nil, err
	}
	for _, f := range fs {
		out[f.SourceID] = append(out[f.SourceID], f)
	}
	return out, nil
}

// OpenSourced is the file fileID of the source's document with its bytes,
// checked against its hash; ErrNotFound when it is not one of them.
func (s *Service) OpenSourced(ctx context.Context, key string, sourceID, fileID uuid.UUID) (SourcedFile, []byte, error) {
	if s.store == nil {
		return SourcedFile{}, nil, ErrNoStorage
	}
	got, err := s.SourcedFiles(ctx, key, []uuid.UUID{sourceID})
	if err != nil {
		return SourcedFile{}, nil, err
	}
	i := slices.IndexFunc(got[sourceID], func(f SourcedFile) bool { return f.ID == fileID })
	if i < 0 {
		return SourcedFile{}, nil, ErrNotFound
	}
	f := got[sourceID][i]
	if f.Sealed {
		// Sourced types are not sealed; a sealed file would need its document's key.
		return SourcedFile{}, nil, ErrNotFound
	}
	data, err := s.fileBytes(ctx, Document{}, f.File)
	if err != nil {
		return SourcedFile{}, nil, err
	}
	return f, data, nil
}

// Sources are the records of type key's source that have a document here.
func (s *Service) Sources(ctx context.Context, key string) ([]uuid.UUID, error) {
	t, err := sourceOf(key)
	if err != nil {
		return nil, err
	}
	return s.repo.Sources(ctx, t.Source)
}
