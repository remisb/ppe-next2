// Package employee holds the people workwear is ordered for and their reusable
// size defaults. Changing a size affects future order resolution only: orders
// snapshot the sizes they used.
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

// Employee is a person orders are prepared for. There is deliberately no glove
// size: gloves and similar PPE are no-size items.
type Employee struct {
	ID              uuid.UUID  `json:"id"`
	FirstName       string     `json:"first_name"`
	LastName        string     `json:"last_name"`
	Code            *string    `json:"code"`
	HeightCm        *int       `json:"height_cm"`
	ClothingSize    *string    `json:"clothing_size"`
	ShoeSize        *string    `json:"shoe_size"`
	Notes           string     `json:"notes"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID uuid.UUID  `json:"updated_by_user_id"`
	DeletedByUserID *uuid.UUID `json:"deleted_by_user_id,omitempty"`
}

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
	ClothingSize *string
	ShoeSize     *string
	Notes        string
}

func (p *Params) Normalize() {
	p.FirstName = strings.TrimSpace(p.FirstName)
	p.LastName = strings.TrimSpace(p.LastName)
	p.Code = blankToNil(p.Code)
	p.ClothingSize = upperBlankToNil(p.ClothingSize)
	p.ShoeSize = blankToNil(p.ShoeSize)
	p.Notes = strings.TrimSpace(p.Notes)
}

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
	}
	s := SizesParams{HeightCm: p.HeightCm, ClothingSize: p.ClothingSize, ShoeSize: p.ShoeSize}
	return s.Validate()
}

// SizesParams is Edit Sizes / Save as Employee Default: the size defaults only.
type SizesParams struct {
	HeightCm     *int
	ClothingSize *string
	ShoeSize     *string
}

func (p *SizesParams) Normalize() {
	p.ClothingSize = upperBlankToNil(p.ClothingSize)
	p.ShoeSize = blankToNil(p.ShoeSize)
}

func (p *SizesParams) Validate() error {
	p.Normalize()
	if p.HeightCm != nil && (*p.HeightCm < minHeightCm || *p.HeightCm > maxHeightCm) {
		return fieldError("height_cm", "must be between 100 and 250")
	}
	if p.ClothingSize != nil && !size.IsClothing(*p.ClothingSize) {
		return fieldError("clothing_size", "is not a known clothing size")
	}
	if p.ShoeSize != nil && !size.IsShoe(*p.ShoeSize) {
		return fieldError("shoe_size", "is not a known shoe size")
	}
	return nil
}

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

func upperBlankToNil(s *string) *string {
	v := blankToNil(s)
	if v != nil {
		*v = strings.ToUpper(*v)
	}
	return v
}
