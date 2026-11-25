package asset

import (
	"context"
	"errors"
	"io"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
)

// MaxSignedCopyBytes is the largest signed copy accepted: a phone photo or a
// multi-page scan (spec, open decision 2).
const MaxSignedCopyBytes = 10 << 20

// SignedCopy is one upload of the signed assignment form, a scan or a photo
// (§9). Uploading again adds one; the newest is the copy shown and the earlier
// ones stay. It is kept in the Document Vault (SignedForms), a version of the
// assignment's document with the copy's id.
type SignedCopy struct {
	ID               uuid.UUID `json:"id"`
	AssignmentID     uuid.UUID `json:"assignment_id"`
	FileName         string    `json:"file_name"`
	ContentType      string    `json:"content_type"`
	SizeBytes        int64     `json:"size_bytes"`
	SHA256           string    `json:"sha256"`
	UploadedAt       time.Time `json:"uploaded_at"`
	UploadedByUserID uuid.UUID `json:"uploaded_by_user_id"`
	// UploadedByName is the uploader's name now; reads fill it.
	UploadedByName string `json:"uploaded_by_name"`
}

// Upload is a file as it arrived: the name the user's device gave it, and its bytes.
type Upload struct {
	FileName string
	Data     []byte
}

// SignedForms is where signed copies are kept: the Document Vault (ADR 0008
// decision 10), adapted in cmd/api/wire_vault.go. Each assignment's copies are
// one document there, each upload a version with the copy's id.
type SignedForms interface {
	// Add keeps f's file, then writes it and the event f.Event makes of it in
	// one transaction, answering the copy as stored.
	Add(ctx context.Context, f SignedForm) (SignedCopy, error)
	// Of are the copies of each assignment, newest first; an assignment
	// without any is left out.
	Of(ctx context.Context, assignmentIDs []uuid.UUID) (map[uuid.UUID][]SignedCopy, error)
	// Open is one copy of the assignment with its bytes, or ErrNotFound.
	Open(ctx context.Context, assignmentID, copyID uuid.UUID) (SignedCopy, io.ReadCloser, error)
	// Holding are the assignments that hold at least one copy.
	Holding(ctx context.Context) ([]uuid.UUID, error)
}

// SignedForm is one upload for SignedForms.Add: the asset and assignment it
// is the signed form of, the copy (its id, name, type and uploader), the
// checked bytes, and the event to record once the copy is stored.
type SignedForm struct {
	Asset      Asset
	Assignment Assignment
	Copy       SignedCopy
	Data       []byte
	Event      func(stored SignedCopy) (audit.Event, error)
}

// WithSignedForms sets where signed copies are kept. Without it, uploading
// and opening one are ErrNoStorage, and no assignment holds one.
func WithSignedForms(forms SignedForms) Option { return func(s *Service) { s.forms = forms } }

// UploadSignedCopy keeps a scan or photo of an assignment's signed form (§9):
// a PDF, JPEG or PNG, read from its bytes, at most 10 MB, a photo's metadata
// removed but for which way up it is. SignedForms stores the file first, then
// its rows and asset.signed_copy_uploaded, so a row never names a file that is
// not there.
func (s *Service) UploadSignedCopy(ctx context.Context, assetID, assignmentID uuid.UUID, u Upload, actor uuid.UUID) (SignedCopy, error) {
	if actor == uuid.Nil {
		return SignedCopy{}, fieldError("actor", "is required")
	}
	if s.forms == nil {
		return SignedCopy{}, ErrNoStorage
	}
	if len(u.Data) == 0 {
		return SignedCopy{}, fieldError("file", "is empty")
	}
	if len(u.Data) > MaxSignedCopyBytes {
		return SignedCopy{}, ErrFileTooLarge
	}
	contentType := files.Sniff(u.Data)
	if contentType == "" {
		return SignedCopy{}, ErrFileType
	}
	data, err := files.Clean(contentType, u.Data)
	if err != nil {
		return SignedCopy{}, fieldError("file", "is damaged")
	}
	// The assignment first, so no file is stored for one that cannot take it.
	// Its form never changes once given (asset_assignments_guard), so the
	// check holds without a lock.
	r, as, err := s.assignment(ctx, assetID, assignmentID)
	if err != nil {
		return SignedCopy{}, err
	}
	if as.Form == nil {
		return SignedCopy{}, ErrNoForm
	}
	c := SignedCopy{
		ID: s.newID(), AssignmentID: assignmentID, FileName: copyName(u.FileName, contentType), ContentType: contentType,
		UploadedAt: s.now(), UploadedByUserID: actor,
	}
	return s.forms.Add(ctx, SignedForm{Asset: r.Asset, Assignment: as, Copy: c, Data: data, Event: func(got SignedCopy) (audit.Event, error) {
		return s.event(actor, EventSignedCopyUploaded, assetID, got.UploadedAt, nil, map[string]any{
			"assignment_id": assignmentID, "file_name": got.FileName, "content_type": got.ContentType,
			"size_bytes": got.SizeBytes, "sha256": got.SHA256,
		})
	}})
}

// SignedCopy opens one signed copy of an asset's assignment, for download.
func (s *Service) SignedCopy(ctx context.Context, assetID, assignmentID, copyID uuid.UUID) (SignedCopy, io.ReadCloser, error) {
	if s.forms == nil {
		return SignedCopy{}, nil, ErrNoStorage
	}
	if _, _, err := s.assignment(ctx, assetID, assignmentID); errors.Is(err, ErrAssignmentNotFound) {
		return SignedCopy{}, nil, ErrNotFound
	} else if err != nil {
		return SignedCopy{}, nil, err
	}
	return s.forms.Open(ctx, assignmentID, copyID)
}

// copiesOf puts each assignment's signed copies on it, newest first, and
// whether it holds one.
func (s *Service) copiesOf(ctx context.Context, as []Assignment) error {
	ids := make([]uuid.UUID, len(as))
	for i, a := range as {
		ids[i] = a.ID
	}
	of := map[uuid.UUID][]SignedCopy{}
	if s.forms != nil && len(ids) > 0 {
		var err error
		if of, err = s.forms.Of(ctx, ids); err != nil {
			return err
		}
	}
	for i := range as {
		as[i].SignedCopies = of[as[i].ID]
		if as[i].SignedCopies == nil {
			as[i].SignedCopies = make([]SignedCopy, 0)
		}
		as[i].SignedCopyUploaded = len(as[i].SignedCopies) > 0
	}
	return nil
}

// holding is the assignments that hold a signed copy; none without SignedForms.
func (s *Service) holding(ctx context.Context) (map[uuid.UUID]bool, error) {
	out := map[uuid.UUID]bool{}
	if s.forms == nil {
		return out, nil
	}
	ids, err := s.forms.Holding(ctx)
	for _, id := range ids {
		out[id] = true
	}
	return out, err
}

// withHolding is holding, also given to f when it keeps the assets held on a
// form without a signed copy, which the repository cannot tell itself.
func (s *Service) withHolding(ctx context.Context, f *ListFilter) (map[uuid.UUID]bool, error) {
	held, err := s.holding(ctx)
	if err != nil {
		return nil, err
	}
	if f.SignedCopyMissing {
		f.Holding = make([]uuid.UUID, 0, len(held))
		for id := range held {
			f.Holding = append(f.Holding, id)
		}
	}
	return held, nil
}

// signedView is r's view, its open assignment marked as held says.
func (s *Service) signedView(r Record, held map[uuid.UUID]bool) View {
	if r.Open != nil {
		r.Open.SignedCopyUploaded = held[r.Open.ID]
	}
	return s.view(r)
}

// markSigned sets whether each assignment holds a signed copy.
func (s *Service) markSigned(ctx context.Context, as ...*Assignment) error {
	if !slices.ContainsFunc(as, func(a *Assignment) bool { return a != nil }) {
		return nil
	}
	held, err := s.holding(ctx)
	if err != nil {
		return err
	}
	for _, a := range as {
		if a != nil {
			a.SignedCopyUploaded = held[a.ID]
		}
	}
	return nil
}

// assignment is the live asset and one of its assignments: ErrNotFound for
// no such asset, ErrAssignmentNotFound for no such assignment of it.
func (s *Service) assignment(ctx context.Context, assetID, assignmentID uuid.UUID) (Record, Assignment, error) {
	r, err := s.repo.Get(ctx, assetID)
	if err != nil {
		return Record{}, Assignment{}, err
	}
	as, err := s.repo.Assignments(ctx, assetID)
	if err != nil {
		return Record{}, Assignment{}, err
	}
	for _, a := range as {
		if a.ID == assignmentID {
			return r, a, nil
		}
	}
	return Record{}, Assignment{}, ErrAssignmentNotFound
}

// copyName is the name a copy is listed and downloaded under (files.Name).
func copyName(name, contentType string) string { return files.Name(name, contentType, "signed-form") }
