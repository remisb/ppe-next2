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

var uses = []string{UseProfile, UseIDBadge, UseSizing, UseReceipt}

// Uses returns every use, in order.
func Uses() []string { return slices.Clone(uses) }

// Photo is one picture of an employee. The file is in the store under ObjectKey.
type Photo struct {
	ID               uuid.UUID  `json:"id"`
	EmployeeID       uuid.UUID  `json:"employee_id"`
	ObjectKey        string     `json:"-"`
	FileName         string     `json:"file_name"`
	ContentType      string     `json:"content_type"`
	SizeBytes        int64      `json:"size_bytes"`
	SHA256           string     `json:"sha256"`
	Uses             []string   `json:"uses"`
	IsDefault        bool       `json:"is_default"`
	UploadedAt       time.Time  `json:"uploaded_at"`
	UploadedByUserID uuid.UUID  `json:"uploaded_by_user_id"`
	DeletedAt        *time.Time `json:"-"`
	DeletedByUserID  *uuid.UUID `json:"-"`
}

// Upload is a file as it arrived: the name the user's device gave it, and its bytes.
type Upload struct {
	FileName string
	Data     []byte
}

var (
	ErrNotFound         = errors.New("employee photo not found")
	ErrEmployeeNotFound = errors.New("employee not found")
	ErrInvalid          = errors.New("invalid employee photo")
	ErrActorNotFound    = errors.New("acting user not found")
	ErrFileTooLarge     = errors.New("photo is too large")
	ErrFileType         = errors.New("photo must be a JPEG or PNG image")
	ErrNoStorage        = errors.New("file storage is not set up")
)

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
