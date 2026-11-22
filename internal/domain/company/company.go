// Package company holds the companies: the organisation's own companies that
// employees are employed by (employee.Employment.CompanyID). One live company
// is the default, which Add New Employee chooses first and mail templates
// name ({{company.name}}). Administration's Companies manages them
// (docs/specs/company-service.md).
package company

import (
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Length limits of a company's text, in characters; the database's CHECKs
// hold the same.
const (
	maxCodeLen        = 32
	maxNameLen        = 200
	maxCompanyCodeLen = 50
	maxVATCodeLen     = 50
	maxAddressLen     = 300
	maxCityLen        = 100
	maxPostalCodeLen  = 20
	maxNotesLen       = 2000
)

// Company is one of the organisation's companies.
type Company struct {
	ID uuid.UUID `json:"id"`
	// Code is the internal code, optional, unique among live companies when set.
	Code string `json:"code"`
	Name string `json:"name"`
	// CompanyCode is the registration number (įmonės kodas); VATCode the VAT
	// payer's code. Both optional.
	CompanyCode string `json:"company_code"`
	VATCode     string `json:"vat_code"`
	Address     string `json:"address"`
	City        string `json:"city"`
	PostalCode  string `json:"postal_code"`
	Country     string `json:"country"` // ISO 3166-1 alpha-2, or empty
	Notes       string `json:"notes"`
	// IsDefault: the default company; at most one live company is.
	IsDefault bool `json:"is_default"`
	// EmployeeCount is the live employees employed by it now (an open
	// employment); read only.
	EmployeeCount   int        `json:"employee_count"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID uuid.UUID  `json:"updated_by_user_id"`
	DeletedByUserID *uuid.UUID `json:"deleted_by_user_id,omitempty"`
}

// Deleted reports whether the company is soft-deleted.
func (c Company) Deleted() bool { return c.DeletedAt != nil }

// Params are the client-settable fields; Update replaces all of them. Which
// company is the default is MakeDefault's, not theirs.
type Params struct {
	Code        string
	Name        string
	CompanyCode string
	VATCode     string
	Address     string
	City        string
	PostalCode  string
	Country     string
	Notes       string
}

// spaces are runs of white space, which the VAT code drops.
var spaces = regexp.MustCompile(`\s+`)

// countryCode is ISO 3166-1 alpha-2's shape.
var countryCode = regexp.MustCompile(`^[A-Z]{2}$`)

// Normalize trims every field, collapses the name's inner spaces, and puts the
// VAT code (without spaces) and the country in upper case.
func (p *Params) Normalize() {
	for _, f := range []*string{&p.Code, &p.CompanyCode, &p.VATCode, &p.Address, &p.City, &p.PostalCode, &p.Country, &p.Notes} {
		*f = strings.TrimSpace(*f)
	}
	p.Name = strings.Join(strings.Fields(p.Name), " ")
	p.VATCode = strings.ToUpper(spaces.ReplaceAllString(p.VATCode, ""))
	p.Country = strings.ToUpper(p.Country)
}

// Validate normalizes p and checks every field.
func (p *Params) Validate() error {
	p.Normalize()
	long := func(s string, max int) bool { return utf8.RuneCountInString(s) > max }
	switch {
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
	case long(p.Notes, maxNotesLen):
		return fieldError("notes", "is too long")
	}
	return nil
}
