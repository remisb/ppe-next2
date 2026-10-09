package asset

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"path"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
)

// MaxSignedCopyBytes is the largest signed copy accepted: a phone photo or a
// multi-page scan (spec, open decision 2).
const MaxSignedCopyBytes = 10 << 20

// SignedCopy is one upload of the signed assignment form, a scan or a photo
// (§9). Uploading again adds one; the newest is the copy shown and the earlier
// ones stay. The file itself is in the files store under ObjectKey.
type SignedCopy struct {
	ID               uuid.UUID `json:"id"`
	AssignmentID     uuid.UUID `json:"assignment_id"`
	ObjectKey        string    `json:"-"`
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

// SignedCopyFunc checks the locked asset and assignment and returns the row and event to write.
type SignedCopyFunc func(a Asset, as Assignment) (SignedCopy, audit.Event, error)

// WithFiles sets where signed copies are kept. Without it, uploads are ErrNoStorage.
func WithFiles(store files.Store) Option { return func(s *Service) { s.files = store } }

// UploadSignedCopy keeps a scan or photo of an assignment's signed form (§9):
// a PDF, JPEG or PNG, read from its bytes, at most 10 MB, a photo's metadata
// removed but for which way up it is. The file is stored first, then its row
// and event, so a row never names a file that is not there.
func (s *Service) UploadSignedCopy(ctx context.Context, assetID, assignmentID uuid.UUID, u Upload, actor uuid.UUID) (SignedCopy, error) {
	if actor == uuid.Nil {
		return SignedCopy{}, fieldError("actor", "is required")
	}
	if s.files == nil {
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
	as, err := s.assignment(ctx, assetID, assignmentID)
	if err != nil {
		return SignedCopy{}, err
	}
	if as.Form == nil {
		return SignedCopy{}, ErrNoForm
	}
	sum := sha256.Sum256(data)
	c := SignedCopy{
		ID: s.newID(), AssignmentID: assignmentID, FileName: copyName(u.FileName, contentType), ContentType: contentType,
		SizeBytes: int64(len(data)), SHA256: hex.EncodeToString(sum[:]), UploadedAt: s.now(), UploadedByUserID: actor,
	}
	c.ObjectKey = "signed-copies/" + assignmentID.String() + "/" + c.ID.String() + files.Ext(contentType)
	if err := s.files.Put(ctx, c.ObjectKey, bytes.NewReader(data), c.SizeBytes, contentType); err != nil {
		return SignedCopy{}, fmt.Errorf("asset: storing signed copy: %w", err)
	}
	err = s.repo.AddSignedCopy(ctx, assetID, assignmentID, func(_ Asset, as Assignment) (SignedCopy, audit.Event, error) {
		if as.Form == nil {
			return SignedCopy{}, audit.Event{}, ErrNoForm
		}
		ev, err := s.event(actor, EventSignedCopyUploaded, assetID, c.UploadedAt, nil, map[string]any{
			"assignment_id": assignmentID, "file_name": c.FileName, "content_type": c.ContentType,
			"size_bytes": c.SizeBytes, "sha256": c.SHA256,
		})
		return c, ev, err
	})
	if err != nil {
		return SignedCopy{}, err
	}
	return c, nil
}

// SignedCopy opens one signed copy of an asset's assignment, for download.
func (s *Service) SignedCopy(ctx context.Context, assetID, assignmentID, copyID uuid.UUID) (SignedCopy, io.ReadCloser, error) {
	if s.files == nil {
		return SignedCopy{}, nil, ErrNoStorage
	}
	c, err := s.repo.SignedCopy(ctx, assetID, assignmentID, copyID)
	if err != nil {
		return SignedCopy{}, nil, err
	}
	r, err := s.files.Get(ctx, c.ObjectKey)
	if err != nil {
		// A row without its file is the store's loss, not the user's mistake.
		return SignedCopy{}, nil, fmt.Errorf("asset: signed copy %s: %w", c.ID, err)
	}
	return c, r, nil
}

// assignment is one of the asset's assignments, or ErrNotFound.
func (s *Service) assignment(ctx context.Context, assetID, assignmentID uuid.UUID) (Assignment, error) {
	if _, err := s.repo.Get(ctx, assetID); err != nil {
		return Assignment{}, err
	}
	as, err := s.repo.Assignments(ctx, assetID)
	if err != nil {
		return Assignment{}, err
	}
	for _, a := range as {
		if a.ID == assignmentID {
			return a, nil
		}
	}
	return Assignment{}, ErrAssignmentNotFound
}

// copyName is the name a copy is listed and downloaded under: the device's
// name without its folder or odd characters, with the extension of what the
// file really is.
func copyName(name, contentType string) string {
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
		clean = "signed-form"
	}
	if r := []rune(clean); len(r) > 150 {
		clean = string(r[:150])
	}
	return clean + files.Ext(contentType)
}
