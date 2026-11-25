package asset

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Archiver keeps a copy of each stored assignment form in the Document Vault
// (ADR 0008 decision 10, phase 6; docs/specs/vault-service.md, "Archiving"),
// adapted in cmd/api/wire_vault.go. Give tells it once its transaction has
// committed; it only queues the copy and never fails or changes Give, and the
// upkeep's sweep (FormsSince) finds what it missed.
type Archiver interface {
	FormStored(ctx context.Context, assignmentID uuid.UUID)
}

// WithArchiver sets where stored forms are archived. Without it nothing is.
func WithArchiver(a Archiver) Option { return func(s *Service) { s.archiver = a } }

// archive tells the archiver that assignment id stored its form.
func (s *Service) archive(ctx context.Context, id uuid.UUID) {
	if s.archiver != nil {
		s.archiver.FormStored(context.WithoutCancel(ctx), id)
	}
}

// StoredForm is an assignment's form as Give stored it, for the archive: the
// asset as it is now (the document's title and links), the assignment, the
// form, the hash Give stored, and the hash of the stored form computed again.
type StoredForm struct {
	Asset      Asset
	Assignment Assignment
	Form       Form
	// StoredHash is the assignment's document hash; DocumentHash the stored
	// form's, computed now. They differ only if the form was changed.
	StoredHash   string
	DocumentHash string
}

// Matches says whether the stored form still hashes to what Give stored.
func (f StoredForm) Matches() bool { return f.StoredHash == f.DocumentHash }

// StoredForm is assignment id's stored form; ErrNotFound when it stored none
// (an asset that needs no form, a SIM card held since the import).
func (s *Service) StoredForm(ctx context.Context, id uuid.UUID) (StoredForm, error) {
	a, as, err := s.repo.StoredForm(ctx, id)
	if err != nil {
		return StoredForm{}, err
	}
	if as.Form == nil || as.DocumentHash == nil {
		return StoredForm{}, ErrNotFound
	}
	// The database keeps the form as JSONB, which reorders its keys: decode
	// and encode it again for the bytes that were hashed (as Form does).
	var f Form
	if err := json.Unmarshal(as.Form, &f); err != nil {
		return StoredForm{}, fmt.Errorf("asset: stored form of %s: %w", as.ID, err)
	}
	_, hash := f.encode()
	return StoredForm{Asset: a, Assignment: as, Form: f, StoredHash: *as.DocumentHash, DocumentHash: hash}, nil
}

// FormsSince are the assignments that stored a form, typed in at or after
// since (the zero time: all), oldest first.
func (s *Service) FormsSince(ctx context.Context, since time.Time) ([]uuid.UUID, error) {
	return s.repo.FormsSince(ctx, since)
}
