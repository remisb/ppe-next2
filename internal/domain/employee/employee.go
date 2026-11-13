// Package employee holds the people workwear is ordered for and their reusable
// size defaults. Changing a size affects future order resolution only: orders
// snapshot the sizes they used. Who may see and change an employee's profile
// and sizes is Sight and Rights (migration 0050); alike names, Not the Same
// Person and Merge Employees are Duplicates and merging (migration 0052). The
// rules are docs/specs/employee-service.md.
package employee

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/size"
)

const (
	maxNameLen  = 100
	maxCodeLen  = 50
	maxNotesLen = 2000
	minHeightCm = 100
	maxHeightCm = 250
)

// Languages an employee may prefer: the ones the app speaks, as user.Language.
var languages = map[string]bool{"en": true, "lt": true, "ru": true}

// Employee is a person orders are prepared for. There is deliberately no glove
// size: gloves and similar PPE are no-size items.
type Employee struct {
	ID           uuid.UUID `json:"id"`
	FirstName    string    `json:"first_name"`
	LastName     string    `json:"last_name"`
	Code         *string   `json:"code"`
	HeightCm     *int      `json:"height_cm"`
	ClothingSize *int      `json:"clothing_size"` // EU size, even 44–66
	ShoeSize     *string   `json:"shoe_size"`
	Notes        string    `json:"notes"`
	// PreferredLanguage is en, lt or ru, or nil when no one has recorded it.
	PreferredLanguage *string `json:"preferred_language"`
	// DefaultPhotoID is the employee's default photo (internal/domain/employeephoto);
	// reads fill it, nothing accepts it.
	DefaultPhotoID *uuid.UUID `json:"default_photo_id"`
	// BirthDate (ISO), Nationality (ICAO code) and Sex (M, F, X) come only
	// from an identity document saved with Add to Employee Record (ADR 0007,
	// Personnel files); reads fill them, the employee's own routes never
	// accept or change them.
	BirthDate       *string    `json:"birth_date"`
	Nationality     *string    `json:"nationality"`
	Sex             *string    `json:"sex"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID uuid.UUID  `json:"updated_by_user_id"`
	DeletedByUserID *uuid.UUID `json:"deleted_by_user_id,omitempty"`
}

// Deleted says whether e is soft-deleted (deleted or merged away).
func (e Employee) Deleted() bool { return e.DeletedAt != nil }

// FullName is derived, never stored or accepted.
func (e Employee) FullName() string { return e.FirstName + " " + e.LastName }

// Sizes returns the employee's size defaults for resolution.
func (e Employee) Sizes() size.Defaults {
	return size.Defaults{HeightCm: e.HeightCm, ClothingSize: e.ClothingSize, ShoeSize: e.ShoeSize}
}

// Params are the client-settable fields. Add New Employee requires only first
// and last name; Update replaces all of them.
type Params struct {
	FirstName    string
	LastName     string
	Code         *string
	HeightCm     *int
	ClothingSize *int
	ShoeSize     *string
	Notes        string
	// PreferredLanguage: en, lt or ru; blank is not set.
	PreferredLanguage *string
}

// Normalize trims every text, and a blank code, shoe size or language becomes nil.
func (p *Params) Normalize() {
	p.FirstName = strings.TrimSpace(p.FirstName)
	p.LastName = strings.TrimSpace(p.LastName)
	p.Code = blankToNil(p.Code)
	p.ShoeSize = blankToNil(p.ShoeSize)
	p.Notes = strings.TrimSpace(p.Notes)
	p.PreferredLanguage = blankToNil(p.PreferredLanguage)
}

// Validate normalizes p, then checks the names are given, the lengths, the
// language and the sizes (SizesParams.Validate); the error wraps ErrInvalid.
func (p *Params) Validate() error {
	p.Normalize()
	switch {
	case p.FirstName == "":
		return fieldError("first_name", "is required")
	case len(p.FirstName) > maxNameLen:
		return fieldError("first_name", "is too long")
	case p.LastName == "":
		return fieldError("last_name", "is required")
	case len(p.LastName) > maxNameLen:
		return fieldError("last_name", "is too long")
	case p.Code != nil && len(*p.Code) > maxCodeLen:
		return fieldError("code", "is too long")
	case len(p.Notes) > maxNotesLen:
		return fieldError("notes", "is too long")
	case p.PreferredLanguage != nil && !languages[*p.PreferredLanguage]:
		return fieldError("preferred_language", "must be en, lt or ru")
	}
	s := SizesParams{HeightCm: p.HeightCm, ClothingSize: p.ClothingSize, ShoeSize: p.ShoeSize}
	return s.Validate()
}

// SizesParams is Edit Sizes / Save as Employee Default: the size defaults only.
type SizesParams struct {
	HeightCm     *int
	ClothingSize *int
	ShoeSize     *string
}

// Normalize makes a blank shoe size nil.
func (p *SizesParams) Normalize() {
	p.ShoeSize = blankToNil(p.ShoeSize)
}

// Validate normalizes p, then checks each size given is one the size
// vocabulary knows and the height is 100–250 cm; the error wraps ErrInvalid.
func (p *SizesParams) Validate() error {
	p.Normalize()
	if p.HeightCm != nil && (*p.HeightCm < minHeightCm || *p.HeightCm > maxHeightCm) {
		return fieldError("height_cm", "must be between 100 and 250")
	}
	if p.ClothingSize != nil && !size.IsClothingNumber(*p.ClothingSize) {
		return fieldError("clothing_size", "is not a known clothing size")
	}
	if p.ShoeSize != nil && !size.IsShoe(*p.ShoeSize) {
		return fieldError("shoe_size", "is not a known shoe size")
	}
	return nil
}

// blankToNil is s trimmed, or nil when s is nil or blank.
func blankToNil(s *string) *string {
	if s == nil {
		return nil
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return nil
	}
	return &v
}
