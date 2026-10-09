// Package asset holds Company Assets: SIM cards and individual equipment and
// furniture, each one physical item, and their assignments to employees
// (docs/specs/asset-service.md, ADR 0004). A SIM card's connection status,
// where an asset is and who holds it are separate facts: only Change Status
// changes the first, and the location follows from the assignments.
package asset

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Kind is SIM for a SIM card, EQUIPMENT for equipment and furniture.
type Kind string

const (
	KindSIM       Kind = "SIM"
	KindEquipment Kind = "EQUIPMENT"
)

func (k Kind) valid() bool { return k == KindSIM || k == KindEquipment }

// Category is an equipment asset's kind of item (assets brief §15).
type Category string

const (
	CategoryComputer      Category = "COMPUTER"
	CategoryPhone         Category = "PHONE"
	CategoryExternalDrive Category = "EXTERNAL_DRIVE"
	CategoryFurniture     Category = "FURNITURE"
	CategoryOther         Category = "OTHER"
)

// prefixes are the inventory number prefixes (§16), by category; SIM cards use "SIM".
var prefixes = map[Category]string{
	CategoryComputer: "PC", CategoryPhone: "PH", CategoryExternalDrive: "DRV", CategoryFurniture: "FUR", CategoryOther: "AST",
}

// PrefixSIM is the SIM cards' inventory number prefix.
const PrefixSIM = "SIM"

// IsPrefix reports whether p is an inventory number prefix.
func IsPrefix(p string) bool {
	if p == PrefixSIM {
		return true
	}
	for _, v := range prefixes {
		if v == p {
			return true
		}
	}
	return false
}

// Status is a SIM card's connection status as the provider confirmed it.
type Status string

const (
	StatusNotActivated Status = "NOT_ACTIVATED"
	StatusActive       Status = "ACTIVE"
	StatusBlocked      Status = "BLOCKED"
)

func (s Status) valid() bool {
	return s == StatusNotActivated || s == StatusActive || s == StatusBlocked
}

// Location is where an asset is. It follows from the open assignment and is
// never stored.
type Location string

const (
	LocationOffice       Location = "OFFICE"
	LocationWithEmployee Location = "WITH_EMPLOYEE"
	LocationUnknown      Location = "UNKNOWN"
)

// Whereabouts is what Mark as Not Returned says of the asset: still with the
// employee, or unknown.
type Whereabouts string

const (
	WhereaboutsWithEmployee Whereabouts = "WITH_EMPLOYEE"
	WhereaboutsUnknown      Whereabouts = "UNKNOWN"
)

// Currency is the organisation's, as the catalogue's.
const Currency = "EUR"

const (
	maxInventoryNoLen = 50
	maxSimNoLen       = 40
	maxPhoneNoLen     = 30
	maxTextLen        = 100
	maxNameLen        = 200
	maxCommentLen     = 2000
	maxValueCents     = 100_000_000_00 // a hundred million euros
)

var (
	simNoPattern   = regexp.MustCompile(`^[0-9A-Za-z ]+$`)
	phoneNoPattern = regexp.MustCompile(`^\+?[0-9 ()-]+$`)
)

// Asset is one physical item the company tracks. SIM fields are nil on
// equipment, and equipment fields nil on a SIM card.
type Asset struct {
	ID                  uuid.UUID  `json:"id"`
	Kind                Kind       `json:"kind"`
	Category            *Category  `json:"category"`
	InventoryNo         string     `json:"inventory_no"`
	Name                *string    `json:"name"`
	SerialNo            *string    `json:"serial_no"`
	SimNo               *string    `json:"sim_no"`
	PhoneNo             *string    `json:"phone_no"`
	Provider            *string    `json:"provider"`
	Plan                *string    `json:"plan"`
	NonReturnValueCents *int64     `json:"non_return_value_cents"`
	Currency            string     `json:"currency"`
	ConnectionStatus    *Status    `json:"connection_status"`
	ReceivedDate        *string    `json:"received_date"` // YYYY-MM-DD
	Comment             string     `json:"comment"`
	WrittenOffAt        *time.Time `json:"written_off_at,omitempty"`
	WrittenOffByUserID  *uuid.UUID `json:"written_off_by_user_id,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	DeletedAt           *time.Time `json:"deleted_at,omitempty"`
	CreatedByUserID     uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID     uuid.UUID  `json:"updated_by_user_id"`
	DeletedByUserID     *uuid.UUID `json:"deleted_by_user_id,omitempty"`
}

func (a Asset) Deleted() bool { return a.DeletedAt != nil }

// Prefix is the inventory number prefix of the asset's kind and category.
func (a Asset) Prefix() string {
	if a.Kind == KindSIM || a.Category == nil {
		return PrefixSIM
	}
	return prefixes[*a.Category]
}

// NeedsForm reports whether giving the asset needs a signed assignment form:
// SIM cards and computer equipment do; furniture and other items do not
// (spec, open decision 6).
func (a Asset) NeedsForm() bool {
	if a.Kind == KindSIM {
		return true
	}
	if a.Category == nil {
		return false
	}
	switch *a.Category {
	case CategoryComputer, CategoryPhone, CategoryExternalDrive:
		return true
	}
	return false
}

// missingFormData names the first field the assignment form needs that the
// asset lacks, or "".
func (a Asset) missingFormData() string {
	if !a.NeedsForm() {
		return ""
	}
	if a.Kind == KindSIM {
		switch {
		case a.PhoneNo == nil:
			return "phone_no"
		case a.Plan == nil:
			return "plan"
		}
	}
	if a.NonReturnValueCents == nil {
		return "non_return_value_cents"
	}
	return ""
}

// Params are an asset's details, as Add SIM Card, Add Asset and Edit set them.
// Which fields apply depends on the kind.
type Params struct {
	Category            *Category
	InventoryNo         string
	Name                *string
	SerialNo            *string
	SimNo               *string
	PhoneNo             *string
	Provider            *string
	Plan                *string
	NonReturnValueCents *int64
	ReceivedDate        *string
	Comment             string
}

// CreateParams add the kind, and a SIM card's status at registration.
type CreateParams struct {
	Params
	Kind Kind
	// ConnectionStatus defaults to Not Activated for a SIM card (§4).
	ConnectionStatus *Status
}

func (p *Params) Normalize() {
	p.InventoryNo = strings.TrimSpace(p.InventoryNo)
	p.Name = blankToNil(p.Name)
	p.SerialNo = blankToNil(p.SerialNo)
	p.SimNo = blankToNil(p.SimNo)
	p.PhoneNo = blankToNil(p.PhoneNo)
	p.Provider = blankToNil(p.Provider)
	p.Plan = blankToNil(p.Plan)
	p.ReceivedDate = blankToNil(p.ReceivedDate)
	p.Comment = strings.TrimSpace(p.Comment)
}

// Validate checks p for an asset of kind; the received date's "not in the
// future" needs the clock, so the service checks it.
func (p *Params) Validate(kind Kind) error {
	p.Normalize()
	switch {
	case p.InventoryNo == "":
		return fieldError("inventory_no", "is required")
	case len(p.InventoryNo) > maxInventoryNoLen:
		return fieldError("inventory_no", "is too long")
	case len(p.Comment) > maxCommentLen:
		return fieldError("comment", "is too long")
	case p.NonReturnValueCents != nil && (*p.NonReturnValueCents < 0 || *p.NonReturnValueCents > maxValueCents):
		return fieldError("non_return_value_cents", "must be between 0 and 10000000000")
	}
	if kind == KindSIM {
		return p.validateSIM()
	}
	return p.validateEquipment()
}

func (p *Params) validateSIM() error {
	switch {
	case p.Category != nil:
		return fieldError("category", "is for equipment only")
	case p.Name != nil:
		return fieldError("name", "is for equipment only")
	case p.SerialNo != nil:
		return fieldError("serial_no", "is for equipment only")
	case p.SimNo == nil:
		return fieldError("sim_no", "is required")
	case len(*p.SimNo) > maxSimNoLen || !simNoPattern.MatchString(*p.SimNo):
		return fieldError("sim_no", "must be at most 40 letters, digits and spaces")
	case p.PhoneNo != nil && (len(*p.PhoneNo) > maxPhoneNoLen || !phoneNoPattern.MatchString(*p.PhoneNo)):
		return fieldError("phone_no", "is not a phone number")
	case p.Provider == nil:
		return fieldError("provider", "is required")
	case len(*p.Provider) > maxTextLen:
		return fieldError("provider", "is too long")
	case p.Plan != nil && len(*p.Plan) > maxTextLen:
		return fieldError("plan", "is too long")
	case p.ReceivedDate != nil && !isDate(*p.ReceivedDate):
		return fieldError("received_date", "must be a date, YYYY-MM-DD")
	}
	return nil
}

func (p *Params) validateEquipment() error {
	switch {
	case p.SimNo != nil, p.PhoneNo != nil, p.Provider != nil, p.Plan != nil, p.ReceivedDate != nil:
		return fieldError("sim_no", "and the other SIM card fields are for SIM cards only")
	case p.Name == nil:
		return fieldError("name", "is required")
	case len(*p.Name) > maxNameLen:
		return fieldError("name", "is too long")
	case p.Category == nil:
		return fieldError("category", "is required")
	case prefixes[*p.Category] == "":
		return fieldError("category", "must be COMPUTER, PHONE, EXTERNAL_DRIVE, FURNITURE or OTHER")
	case p.SerialNo != nil && len(*p.SerialNo) > maxTextLen:
		return fieldError("serial_no", "is too long")
	}
	return nil
}

// Validate checks the kind and, for a SIM card, the status.
func (p *CreateParams) Validate() error {
	if !p.Kind.valid() {
		return fieldError("kind", "must be SIM or EQUIPMENT")
	}
	if err := p.Params.Validate(p.Kind); err != nil {
		return err
	}
	if p.Kind == KindEquipment && p.ConnectionStatus != nil {
		return fieldError("connection_status", "is for SIM cards only")
	}
	if p.ConnectionStatus != nil && !p.ConnectionStatus.valid() {
		return fieldError("connection_status", "must be NOT_ACTIVATED, ACTIVE or BLOCKED")
	}
	return nil
}

// FormatNumber is the suggested inventory number n of prefix, "SIM-000001".
func FormatNumber(prefix string, n int64) string { return fmt.Sprintf("%s-%06d", prefix, n) }

// numberOf is n when number is FormatNumber(prefix, n) (case-insensitive,
// six or more digits), else 0.
func numberOf(prefix, number string) int64 {
	head, digits, ok := strings.Cut(number, "-")
	if !ok || !strings.EqualFold(head, prefix) || len(digits) < 6 {
		return 0
	}
	var n int64
	for _, c := range digits {
		if c < '0' || c > '9' || n > 1e15 {
			return 0
		}
		n = n*10 + int64(c-'0')
	}
	return n
}

// compactSIM is a SIM number as compared: without spaces.
func compactSIM(s string) string { return strings.ReplaceAll(s, " ", "") }

func isDate(s string) bool {
	_, err := time.Parse(time.DateOnly, s)
	return err == nil
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
