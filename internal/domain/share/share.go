// Package share holds shared links (WARE-51): a few records' details, the
// columns chosen, as their sharer saw them, open to anyone with the link
// until it expires or the sharer revokes it. The rows come in as JSON built
// by the caller (the transport shapes them as the sharer may see them); this
// package keeps them, the hashed token and the rules. The rules are
// docs/specs/share-service.md.
package share

import (
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Kind is what a link shares.
type Kind string

// KindEmployees: employees' details, from the Employees export sheet.
const KindEmployees Kind = "employees"

const (
	// MaxRows is the most rows a link may hold.
	MaxRows = 10
	// MaxNameLen is the longest name, in characters.
	MaxNameLen = 100
	// MaxColumns is the most columns a link may hold.
	MaxColumns = 50
)

// Durations are the days a link may stay open, from the shortest.
var Durations = []int{1, 7, 30}

// Share is a shared link. Rows are empty once it is erased (revoked or
// expired); lists leave them out.
type Share struct {
	ID         uuid.UUID         `json:"id"`
	Kind       Kind              `json:"kind"`
	Name       string            `json:"name"`
	Columns    []string          `json:"columns"`
	SubjectIDs []uuid.UUID       `json:"subject_ids"`
	Rows       []json.RawMessage `json:"-"`
	// RowCount is len(SubjectIDs), kept after the rows are erased.
	RowCount        int        `json:"row_count"`
	ExpiresAt       time.Time  `json:"expires_at"`
	CreatedAt       time.Time  `json:"created_at"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	CreatedByName   string     `json:"created_by_name"`
	RevokedAt       *time.Time `json:"revoked_at,omitempty"`
	RevokedByUserID *uuid.UUID `json:"revoked_by_user_id,omitempty"`
	ErasedAt        *time.Time `json:"erased_at,omitempty"`
	// TokenHash is the hex SHA-256 of the link's token; never answered.
	TokenHash string `json:"-"`
}

// Open says whether the link may be opened at now: not revoked, not expired.
func (s Share) Open(now time.Time) bool {
	return s.RevokedAt == nil && now.Before(s.ExpiresAt)
}

// CreateParams are Share Link's input: the rows already shaped by the caller,
// one per subject, in the same order.
type CreateParams struct {
	Kind       Kind
	Name       string
	Columns    []string
	SubjectIDs []uuid.UUID
	Rows       []json.RawMessage
	Days       int
}

// Normalize trims the name and the columns.
func (p *CreateParams) Normalize() {
	p.Name = strings.TrimSpace(p.Name)
	for i, c := range p.Columns {
		p.Columns[i] = strings.TrimSpace(c)
	}
}

// Validate normalizes p and checks every rule a link's input must keep.
func (p *CreateParams) Validate() error {
	p.Normalize()
	if p.Kind != KindEmployees {
		return fieldError("kind", "is not one that can be shared")
	}
	if p.Name == "" {
		return fieldError("name", "is required")
	}
	if len([]rune(p.Name)) > MaxNameLen {
		return fieldError("name", "is longer than 100 characters")
	}
	if len(p.Columns) == 0 || len(p.Columns) > MaxColumns {
		return fieldError("columns", "must name 1 to 50 columns")
	}
	seen := map[string]bool{}
	for _, c := range p.Columns {
		if c == "" || seen[c] {
			return fieldError("columns", "must name each column once")
		}
		seen[c] = true
	}
	if err := CheckRows(len(p.SubjectIDs)); err != nil {
		return err
	}
	ids := map[uuid.UUID]bool{}
	for _, id := range p.SubjectIDs {
		if id == uuid.Nil || ids[id] {
			return fieldError("ids", "must name each record once")
		}
		ids[id] = true
	}
	if len(p.Rows) != len(p.SubjectIDs) {
		return fieldError("rows", "must be one per record")
	}
	if !slices.Contains(Durations, p.Days) {
		return fieldError("days", "must be 1, 7 or 30")
	}
	return nil
}

// CheckRows refuses a link of n rows: none, or more than MaxRows. The
// transport calls it before reading the records.
func CheckRows(n int) error {
	if n < 1 || n > MaxRows {
		return fieldError("ids", "must name 1 to 10 records")
	}
	return nil
}
