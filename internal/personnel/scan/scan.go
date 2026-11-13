// Package scan is Personnel files' kept scans (ADR 0007 amendment,
// docs/specs/personnel-service.md "Kept scans"): Import Documents' Scan
// Document builds one person's flattened document pages into a zip, which the
// API keeps for a few days (API_PERSONNEL_SCAN_DAYS), for the user who made
// it alone, so the work need not be done again.
//
// The zip and what names it (the person's names, the document's kind and
// number, the file name) are sealed under a data key of the scan's own, which
// Personnel files' master key seals. Deleting the row (Remove, or the upkeep
// once it expires) is the erasure: the object, wherever a bucket keeps it,
// never opens again.
//
// Nothing read from a document is ever put into an error, a log line, a URL
// or an audit event: events carry the scan's id and its page count only.
package scan

import (
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
)

// Audit event names. Each is on the scan (entity type "personnel_scan").
const (
	EventKept       = "personnel.scan_kept"
	EventDownloaded = "personnel.scan_downloaded"
	EventRemoved    = "personnel.scan_removed"
	// EntityType is the events' entity type.
	EntityType = "personnel_scan"
)

// Kind is what document the scan is of.
type Kind string

const (
	Passport        Kind = "passport"
	IDCard          Kind = "id_card"
	ResidencePermit Kind = "residence_permit"
)

// valid reports whether k is one of the three kinds.
func (k Kind) valid() bool { return k == Passport || k == IDCard || k == ResidencePermit }

// word is the kind as the file name says it.
func (k Kind) word() string {
	switch k {
	case IDCard:
		return "id-card"
	case ResidencePermit:
		return "residence-permit"
	}
	return "passport"
}

// Limits: at most MaxPages pages, each a JPEG of at most
// document.MaxCopySize and document.MaxCopySide; names as the document
// service limits them; DefaultDays and MaxDays bound API_PERSONNEL_SCAN_DAYS.
const (
	MaxPages     = 10
	maxNameLen   = 100
	maxNumberLen = 20
	DefaultDays  = 3
	MinDays      = 1
	MaxDays      = 14
)

// Meta is what names a scan, as Scan Document sends it: the person's names
// as printed (or typed), the document's kind and number, and optionally the
// MRZ lines it was read from, which are checked and not kept.
type Meta struct {
	Surname    string   `json:"surname"`
	GivenNames string   `json:"given_names"`
	Kind       Kind     `json:"kind"`
	Number     string   `json:"number"`
	MRZ        []string `json:"mrz,omitempty"`
}

// Normalize trims what was typed; the number is upper case.
func (m *Meta) Normalize() {
	m.Surname = strings.Join(strings.Fields(m.Surname), " ")
	m.GivenNames = strings.Join(strings.Fields(m.GivenNames), " ")
	m.Number = strings.ToUpper(strings.TrimSpace(m.Number))
	for i, l := range m.MRZ {
		m.MRZ[i] = strings.ToUpper(strings.TrimSpace(l))
	}
}

// Validate checks the meta's shape; the MRZ's own rules are the parser's.
func (m *Meta) Validate() error {
	m.Normalize()
	switch {
	case !m.Kind.valid():
		return fieldError("kind", "must be passport, id_card or residence_permit")
	case m.Surname == "":
		return fieldError("surname", "is required")
	case fileWord(m.Surname) == "":
		return fieldError("surname", "has no letters")
	case len(m.Surname) > maxNameLen || len(m.GivenNames) > maxNameLen:
		return fieldError("names", "are too long")
	case len(m.Number) > maxNumberLen:
		return fieldError("number", "is too long")
	case strings.IndexFunc(m.Number, func(r rune) bool { return !(r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') }) >= 0:
		return fieldError("number", "may hold only letters and digits")
	case len(m.MRZ) == 1 || len(m.MRZ) > 3:
		return fieldError("mrz", "must be two or three lines")
	}
	return nil
}

// FileName is the archive's name: <Surname>_<Given>_<kind>.zip, spaces as
// underscores, any character a file name should not hold left out.
func (m Meta) FileName() string {
	parts := []string{fileWord(m.Surname)}
	if g := fileWord(m.GivenNames); g != "" {
		parts = append(parts, g)
	}
	return strings.Join(append(parts, m.Kind.word()), "_") + ".zip"
}

// fileWord is s for a file name: letters, digits and hyphens kept, spaces
// as one underscore, everything else left out.
func fileWord(s string) string {
	var b strings.Builder
	space := false
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-':
			if space && b.Len() > 0 {
				b.WriteByte('_')
			}
			space = false
			b.WriteRune(r)
		case unicode.IsSpace(r) || r == '_':
			space = true
		}
	}
	return b.String()
}

// Scan is a kept scan as its maker sees it in Recent scans.
type Scan struct {
	ID         uuid.UUID `json:"id"`
	FileName   string    `json:"file_name"`
	Surname    string    `json:"surname"`
	GivenNames string    `json:"given_names"`
	Kind       Kind      `json:"kind"`
	Number     string    `json:"number"`
	Pages      int       `json:"pages"`
	Bytes      int       `json:"bytes"`
	CreatedAt  time.Time `json:"created_at"`
	ExpiresAt  time.Time `json:"expires_at"`
}

// Archive is an opened scan: the zip and its file name.
type Archive struct {
	FileName string
	Zip      []byte
}

// sealedMeta is what the row's sealed_meta holds.
type sealedMeta struct {
	Surname    string `json:"surname"`
	GivenNames string `json:"given_names"`
	Kind       Kind   `json:"kind"`
	Number     string `json:"number"`
	FileName   string `json:"file_name"`
}
