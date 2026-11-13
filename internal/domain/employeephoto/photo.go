// Package employeephoto keeps the photos of employees: any number each, one of
// them the default (the employee's avatar), each optionally tagged with the
// uses it serves. The files are in the files store; changes are recorded on the
// employee's own history.
package employeephoto

import (
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
)

// MaxBytes is the largest photo accepted: a phone photo.
const MaxBytes = 10 << 20

// Uses a photo may serve, in the order they are listed and stored. A photo has
// none, one or several.
const (
	UseProfile = "profile"  // the employee's picture in lists and on their page
	UseIDBadge = "id_badge" // the photo for the employee's ID badge
	UseSizing  = "sizing"   // shows how workwear fits, for choosing sizes
	UseReceipt = "receipt"  // the employee with the issued items
)

// uses is every use, in order.
var uses = []string{UseProfile, UseIDBadge, UseSizing, UseReceipt}

// Uses returns every use, in order.
func Uses() []string { return slices.Clone(uses) }

// Photo is one picture of an employee. The file is in the store under ObjectKey.
type Photo struct {
	ID               uuid.UUID `json:"id"`
	EmployeeID       uuid.UUID `json:"employee_id"`
	ObjectKey        string    `json:"-"`
	FileName         string    `json:"file_name"`
	ContentType      string    `json:"content_type"`
	SizeBytes        int64     `json:"size_bytes"`
	SHA256           string    `json:"sha256"`
	Uses             []string  `json:"uses"`
	IsDefault        bool      `json:"is_default"`
	UploadedAt       time.Time `json:"uploaded_at"`
	UploadedByUserID uuid.UUID `json:"uploaded_by_user_id"`
	// AIGenerated marks a photo an AI coloured (ADR 0007, PR-7): labelled so
	// everywhere, never the ID badge's, and kept with the person's Consent.
	AIGenerated     bool       `json:"ai_generated"`
	Consent         *Consent   `json:"consent,omitempty"`
	DeletedAt       *time.Time `json:"-"`
	DeletedByUserID *uuid.UUID `json:"-"`
}

// Upload is a file as it arrived: the name the user's device gave it, and its
// bytes; an AI-coloured one says so, with how the person consented (PR-6).
type Upload struct {
	FileName    string
	Data        []byte
	AIGenerated bool
	// ConsentBy is how the person consented to the AI colouring: verbal or written.
	ConsentBy string
}

// Consent is the person's consent to an AI-coloured photo: how, recorded by whom and when.
type Consent struct {
	By         string    `json:"by"`
	RecordedBy uuid.UUID `json:"recorded_by_user_id"`
	At         time.Time `json:"at"`
}

var (
	// ErrNotFound is no live photo by that id for the employee (404).
	ErrNotFound = errors.New("employee photo not found")
	// ErrEmployeeNotFound is no live employee by that id (404).
	ErrEmployeeNotFound = errors.New("employee not found")
	// ErrInvalid is a field that breaks a rule (400); fieldError names it.
	ErrInvalid = errors.New("invalid employee photo")
	// ErrActorNotFound is an acting user who no longer exists (401).
	ErrActorNotFound = errors.New("acting user not found")
	// ErrFileTooLarge is a photo over MaxBytes (413).
	ErrFileTooLarge = errors.New("photo is too large")
	// ErrFileType is a file whose bytes are not a JPEG or PNG (415).
	ErrFileType = errors.New("photo must be a JPEG or PNG image")
	// ErrNoStorage is a service without a files store (503).
	ErrNoStorage = errors.New("file storage is not set up")
)

// fieldError is ErrInvalid, naming the field and what is wrong with it.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// NormalizeUses checks the uses against the list and returns them without
// repeats, in the list's order; none is allowed.
func NormalizeUses(in []string) ([]string, error) {
	for _, u := range in {
		if !slices.Contains(uses, u) {
			return nil, fieldError("uses", fmt.Sprintf("has unknown use %q", u))
		}
	}
	out := make([]string, 0, len(in))
	for _, u := range uses {
		if slices.Contains(in, u) {
			out = append(out, u)
		}
	}
	return out, nil
}
