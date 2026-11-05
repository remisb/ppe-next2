// Package document is Personnel files' identity documents (ADR 0007,
// docs/specs/personnel-service.md): passports, ID cards and residence
// permits read by docs-import, their images (Document Copies), kept sealed
// with the person's own data key.
//
// Nothing read from a document is ever put into an error, a log line or an
// audit event: problems are codes with a field's name, events carry the kind,
// issuing state and dates only.
package document

import (
	"strings"
	"time"

	"github.com/google/uuid"
)

// Audit event names. Every one is on the employee (entity type "employee"), so
// it reads on the employee's Changes and the Audit log.
const (
	EventRecorded          = "personnel.document_recorded"
	EventSuperseded        = "personnel.document_superseded"
	EventUpdated           = "personnel.document_updated"
	EventShown             = "personnel.document_shown"
	EventRemoved           = "personnel.document_removed"
	EventEmploymentEnded   = "personnel.employment_ended"
	EventEmploymentCleared = "personnel.employment_end_cleared"
	EventHoldSet           = "personnel.hold_set"
	EventHoldCleared       = "personnel.hold_cleared"
	EventFileShredded      = "personnel.file_shredded"
	auditEntity            = "employee"
)

// Kind is what a document is.
type Kind string

const (
	Passport        Kind = "passport"
	IDCard          Kind = "id_card"
	ResidencePermit Kind = "residence_permit"
)

func (k Kind) valid() bool { return k == Passport || k == IDCard || k == ResidencePermit }

// Side is which image of a document a copy is.
type Side string

const (
	SidePage     Side = "page"     // a passport's data page
	SideFront    Side = "front"    // a card's front, with the portrait
	SideBack     Side = "back"     // a card's back, with the MRZ
	SidePortrait Side = "portrait" // the portrait cut from the document
)

func (s Side) valid() bool {
	return s == SidePage || s == SideFront || s == SideBack || s == SidePortrait
}

// Fields are what is sealed with the person's data key: everything the
// document gives except its kind, issuing state and dates.
type Fields struct {
	Number       string   `json:"number"`
	PersonalCode string   `json:"personal_code,omitempty"`
	MRZ          []string `json:"mrz"`
	// Surname and GivenNames are as printed, with diacritics, as the user typed them.
	Surname      string `json:"surname"`
	GivenNames   string `json:"given_names"`
	BirthDate    string `json:"birth_date,omitempty"` // ISO
	Nationality  string `json:"nationality"`
	Sex          string `json:"sex,omitempty"`
	PlaceOfBirth string `json:"place_of_birth,omitempty"`
	Authority    string `json:"authority,omitempty"`
}

// Document is an identity document as everyone allowed to know of it sees it:
// never a sealed field.
type Document struct {
	ID               uuid.UUID  `json:"id"`
	EmployeeID       uuid.UUID  `json:"employee_id"`
	Kind             Kind       `json:"kind"`
	IssuingState     string     `json:"issuing_state"`
	IssuedOn         *string    `json:"issued_on"`  // ISO, or null
	ExpiresOn        string     `json:"expires_on"` // ISO
	OnEmployeeRecord bool       `json:"on_employee_record"`
	Copies           []Side     `json:"copies"`
	SupersededAt     *time.Time `json:"superseded_at"`
	CreatedAt        time.Time  `json:"created_at"`
	CreatedByUserID  uuid.UUID  `json:"created_by_user_id"`
}

// NewEmployee is the employee a document creates (D6): the printed names, and
// a code if the user gave one.
type NewEmployee struct {
	FirstName string
	LastName  string
	Code      *string
}

// Take names an employee field a document may fill (FR-8).
type Take string

const (
	TakeNames       Take = "names"
	TakeBirthDate   Take = "birth_date"
	TakeNationality Take = "nationality"
	TakeSex         Take = "sex"
)

// SaveParams is a reviewed document, as docs-import sends it.
type SaveParams struct {
	// EmployeeID is the person, or uuid.Nil with New set.
	EmployeeID uuid.UUID
	New        *NewEmployee
	MRZ        []string
	Kind       Kind
	Surname    string
	GivenNames string
	// IssuedOn, PlaceOfBirth and Authority are not in the MRZ: typed, optional.
	IssuedOn     string
	PlaceOfBirth string
	Authority    string
	// AddToEmployeeRecord is the review's switch; Take the employee fields it writes.
	AddToEmployeeRecord bool
	Take                []Take
	// Copies are the images, JPEG, by side.
	Copies map[Side][]byte
}

// Normalize trims what was typed.
func (p *SaveParams) Normalize() {
	for i, l := range p.MRZ {
		p.MRZ[i] = strings.ToUpper(strings.TrimSpace(l))
	}
	p.Surname = strings.TrimSpace(p.Surname)
	p.GivenNames = strings.TrimSpace(p.GivenNames)
	p.IssuedOn = strings.TrimSpace(p.IssuedOn)
	p.PlaceOfBirth = strings.TrimSpace(p.PlaceOfBirth)
	p.Authority = strings.TrimSpace(p.Authority)
	if p.New != nil {
		p.New.FirstName = strings.TrimSpace(p.New.FirstName)
		p.New.LastName = strings.TrimSpace(p.New.LastName)
		if p.New.Code != nil {
			c := strings.TrimSpace(*p.New.Code)
			p.New.Code = &c
			if c == "" {
				p.New.Code = nil
			}
		}
	}
}

const (
	maxNameLen  = 100
	maxTextLen  = 200
	maxCopySize = 5 << 20
	maxCopySide = 2400
)

// Validate checks the params' shape; the MRZ's own rules are the parser's.
func (p *SaveParams) Validate() error {
	p.Normalize()
	switch {
	case (p.EmployeeID == uuid.Nil) == (p.New == nil):
		return fieldError("employee", "must be an existing employee or a new one")
	case p.New != nil && (p.New.FirstName == "" || p.New.LastName == ""):
		return fieldError("employee", "needs a first and a last name")
	case p.New != nil && (len(p.New.FirstName) > maxNameLen || len(p.New.LastName) > maxNameLen):
		return fieldError("employee", "name is too long")
	case len(p.MRZ) < 2 || len(p.MRZ) > 3:
		return fieldError("mrz", "must be two or three lines")
	case !p.Kind.valid():
		return fieldError("kind", "must be passport, id_card or residence_permit")
	case p.Surname == "":
		return fieldError("surname", "is required")
	case len(p.Surname) > maxNameLen || len(p.GivenNames) > maxNameLen:
		return fieldError("names", "are too long")
	case len(p.PlaceOfBirth) > maxTextLen:
		return fieldError("place_of_birth", "is too long")
	case len(p.Authority) > maxTextLen:
		return fieldError("authority", "is too long")
	case p.IssuedOn != "" && !isISODate(p.IssuedOn):
		return fieldError("issued_on", "must be a date (YYYY-MM-DD)")
	}
	for _, t := range p.Take {
		if t != TakeNames && t != TakeBirthDate && t != TakeNationality && t != TakeSex {
			return fieldError("take", "names an unknown field")
		}
	}
	if len(p.Take) > 0 && !p.AddToEmployeeRecord {
		return fieldError("take", "needs Add to Employee Record")
	}
	return validateCopies(p.Kind, p.Copies)
}

// validateCopies: a passport's copy is its page, a card's its front and back,
// and either may have its portrait. Each is a JPEG of at most 5 MB and 2400 px.
func validateCopies(kind Kind, copies map[Side][]byte) error {
	for side, b := range copies {
		if !side.valid() {
			return fieldError("copies", "names an unknown side")
		}
		if kind == Passport && (side == SideFront || side == SideBack) {
			return fieldError("copies", "a passport's copy is its page")
		}
		if kind != Passport && side == SidePage {
			return fieldError("copies", "a card's copies are its front and back")
		}
		if len(b) > maxCopySize {
			return ErrCopyTooLarge
		}
		if err := checkJPEG(b); err != nil {
			return err
		}
	}
	return nil
}

func isISODate(s string) bool {
	_, err := time.Parse(time.DateOnly, s)
	return err == nil
}
