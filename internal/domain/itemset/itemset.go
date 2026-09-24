// Package itemset holds Item Sets: reusable lists of catalogue items with
// default quantities. A set never stores sizes, prices or service periods;
// applying it resolves those fresh from the employee and the catalogue.
package itemset

import (
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	maxNameLen        = 200
	maxDescriptionLen = 1000
	maxLines          = 100
)

type ItemSet struct {
	ID              uuid.UUID  `json:"id"`
	Name            string     `json:"name"`
	Description     string     `json:"description"`
	Active          bool       `json:"active"`
	Lines           []Line     `json:"lines"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID uuid.UUID  `json:"updated_by_user_id"`
	DeletedByUserID *uuid.UUID `json:"deleted_by_user_id,omitempty"`
}

func (s ItemSet) Deleted() bool { return s.DeletedAt != nil }

// Line references one catalogue item. DisplayOrder is the position in the set,
// assigned from the order lines are sent in.
type Line struct {
	CatalogueItemID uuid.UUID `json:"catalogue_item_id"`
	DefaultQuantity int       `json:"default_quantity"`
	DisplayOrder    int       `json:"display_order"`
}

// LineParams is a client-sent line; its position in the list is its order.
type LineParams struct {
	CatalogueItemID uuid.UUID
	DefaultQuantity int
}

// Params are the client-settable fields; Update replaces all of them,
// including the whole line list.
type Params struct {
	Name        string
	Description string
	Active      bool
	Lines       []LineParams
}

func (p *Params) Normalize() {
	p.Name = strings.TrimSpace(p.Name)
	p.Description = strings.TrimSpace(p.Description)
}

func (p *Params) Validate() error {
	p.Normalize()
	switch {
	case p.Name == "":
		return fieldError("name", "is required")
	case len(p.Name) > maxNameLen:
		return fieldError("name", "is too long")
	case len(p.Description) > maxDescriptionLen:
		return fieldError("description", "is too long")
	case len(p.Lines) == 0:
		return fieldError("lines", "must contain at least one item")
	case len(p.Lines) > maxLines:
		return fieldError("lines", "has too many items")
	}
	seen := make(map[uuid.UUID]bool, len(p.Lines))
	for i, l := range p.Lines {
		field := "lines[" + strconv.Itoa(i) + "]"
		switch {
		case l.CatalogueItemID == uuid.Nil:
			return fieldError(field+".catalogue_item_id", "is required")
		case seen[l.CatalogueItemID]:
			return fieldError(field+".catalogue_item_id", "appears more than once")
		case l.DefaultQuantity < 1:
			return fieldError(field+".default_quantity", "must be at least 1")
		}
		seen[l.CatalogueItemID] = true
	}
	return nil
}

// ToLines assigns display order from list position.
func (p Params) ToLines() []Line {
	out := make([]Line, len(p.Lines))
	for i, l := range p.Lines {
		out[i] = Line{CatalogueItemID: l.CatalogueItemID, DefaultQuantity: l.DefaultQuantity, DisplayOrder: i}
	}
	return out
}
