// Package supplier holds the suppliers: the companies catalogue items are
// bought from. Each has an internal code, unique among live suppliers, and the
// details an organisation is known by. An item names its supplier
// (catalogue.Item.SupplierID); Administration's Suppliers manages them
// (docs/specs/supplier-service.md).
package supplier

import (
	"net/mail"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Length limits of a supplier's text, in characters; the database's CHECKs
// hold the same.
const (
	maxCodeLen          = 32
	maxNameLen          = 200
	maxCompanyCodeLen   = 50
	maxVATCodeLen       = 50
	maxAddressLen       = 300
	maxCityLen          = 100
	maxPostalCodeLen    = 20
	maxContactPersonLen = 200
	maxEmailLen         = 254
	maxPhoneLen         = 50
	maxWebsiteLen       = 300
	maxBankAccountLen   = 50
	maxNotesLen         = 2000
)

// Supplier is a company catalogue items are bought from.
type Supplier struct {
	ID   uuid.UUID `json:"id"`
	Code string    `json:"code"`
	Name string    `json:"name"`
	// CompanyCode is the registration number (įmonės kodas); VATCode the VAT
	// payer's code. Both optional.
	CompanyCode   string `json:"company_code"`
	VATCode       string `json:"vat_code"`
	Address       string `json:"address"`
	City          string `json:"city"`
	PostalCode    string `json:"postal_code"`
	Country       string `json:"country"` // ISO 3166-1 alpha-2, or empty
	ContactPerson string `json:"contact_person"`
	Email         string `json:"email"`
	Phone         string `json:"phone"`
	Website       string `json:"website"`
	BankAccount   string `json:"bank_account"`
	Notes         string `json:"notes"`
	// ItemCount is the live catalogue items naming the supplier; read only.
	ItemCount       int        `json:"item_count"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID uuid.UUID  `json:"updated_by_user_id"`
	DeletedByUserID *uuid.UUID `json:"deleted_by_user_id,omitempty"`
}

// Deleted reports whether the supplier is soft-deleted.
func (s Supplier) Deleted() bool { return s.DeletedAt != nil }

// Params are the client-settable fields; Update replaces all of them.
type Params struct {
	Code          string
	Name          string
	CompanyCode   string
	VATCode       string
	Address       string
	City          string
	PostalCode    string
	Country       string
	ContactPerson string
	Email         string
	Phone         string
	Website       string
	BankAccount   string
	Notes         string
}

// spaces are runs of white space, which codes and bank accounts drop.
var spaces = regexp.MustCompile(`\s+`)

// countryCode is ISO 3166-1 alpha-2's shape.
var countryCode = regexp.MustCompile(`^[A-Z]{2}$`)

// Normalize trims every field; puts the VAT code, country and bank account in
// upper case, the bank account without spaces (an IBAN as typed in groups of
// four), and the email in lower case.
func (p *Params) Normalize() {
	for _, f := range []*string{&p.Code, &p.Name, &p.CompanyCode, &p.VATCode, &p.Address, &p.City, &p.PostalCode,
		&p.Country, &p.ContactPerson, &p.Email, &p.Phone, &p.Website, &p.BankAccount, &p.Notes} {
		*f = strings.TrimSpace(*f)
	}
	p.VATCode = strings.ToUpper(spaces.ReplaceAllString(p.VATCode, ""))
	p.Country = strings.ToUpper(p.Country)
	p.BankAccount = strings.ToUpper(spaces.ReplaceAllString(p.BankAccount, ""))
	p.Email = strings.ToLower(p.Email)
}

// Validate normalizes p and checks every field.
func (p *Params) Validate() error {
	p.Normalize()
	long := func(s string, max int) bool { return utf8.RuneCountInString(s) > max }
	switch {
	case p.Code == "":
		return fieldError("code", "is required")
	case long(p.Code, maxCodeLen):
		return fieldError("code", "is too long")
	case p.Name == "":
		return fieldError("name", "is required")
	case long(p.Name, maxNameLen):
		return fieldError("name", "is too long")
	case long(p.CompanyCode, maxCompanyCodeLen):
		return fieldError("company_code", "is too long")
	case long(p.VATCode, maxVATCodeLen):
		return fieldError("vat_code", "is too long")
	case long(p.Address, maxAddressLen):
		return fieldError("address", "is too long")
	case long(p.City, maxCityLen):
		return fieldError("city", "is too long")
	case long(p.PostalCode, maxPostalCodeLen):
		return fieldError("postal_code", "is too long")
	case p.Country != "" && !countryCode.MatchString(p.Country):
		return fieldError("country", "must be a two-letter country code")
	case long(p.ContactPerson, maxContactPersonLen):
		return fieldError("contact_person", "is too long")
	case long(p.Email, maxEmailLen):
		return fieldError("email", "is too long")
	case p.Email != "" && !validEmail(p.Email):
		return fieldError("email", "is not an email address")
	case long(p.Phone, maxPhoneLen):
		return fieldError("phone", "is too long")
	case long(p.Website, maxWebsiteLen):
		return fieldError("website", "is too long")
	case long(p.BankAccount, maxBankAccountLen):
		return fieldError("bank_account", "is too long")
	case long(p.Notes, maxNotesLen):
		return fieldError("notes", "is too long")
	}
	return nil
}

// validEmail reports whether s is one bare address (no display name).
func validEmail(s string) bool {
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s
}
