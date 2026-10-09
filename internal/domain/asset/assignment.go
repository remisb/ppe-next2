package asset

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Assignment is one giving of an asset to one employee, open until the asset
// is returned. It is never deleted or rewritten: only the Not Returned mark
// and the return are set later, each once (a trigger in migration 0029 holds
// this).
type Assignment struct {
	ID            uuid.UUID `json:"id"`
	AssetID       uuid.UUID `json:"asset_id"`
	EmployeeID    uuid.UUID `json:"employee_id"`
	GivenDate     string    `json:"given_date"` // YYYY-MM-DD, the actual day
	GivenByUserID uuid.UUID `json:"given_by_user_id"`
	CreatedAt     time.Time `json:"created_at"` // when it was typed in
	Comment       string    `json:"comment"`
	// Form is the assignment form's data as printed; nil when the asset needs none.
	Form                json.RawMessage `json:"form"`
	FormTemplateVersion *string         `json:"form_template_version"`
	DocumentHash        *string         `json:"document_hash"`
	PaperFormSigned     bool            `json:"paper_form_signed"`
	NotReturnedAt       *time.Time      `json:"not_returned_at"`
	NotReturnedByUserID *uuid.UUID      `json:"not_returned_by_user_id"`
	NotReturnedComment  *string         `json:"not_returned_comment"`
	Whereabouts         *Whereabouts    `json:"whereabouts"`
	ReturnedDate        *string         `json:"returned_date"`
	ReturnedAt          *time.Time      `json:"returned_at"`
	ReturnedByUserID    *uuid.UUID      `json:"returned_by_user_id"`
	ReturnComment       *string         `json:"return_comment"`
	// EmployeeName is the employee's name now; reads fill it, it is not stored.
	EmployeeName string `json:"employee_name"`
}

// Open reports whether the asset has not been returned from this assignment.
func (a Assignment) Open() bool { return a.ReturnedDate == nil }

// EmployeeView is what giving reads of the employee, locked for the write.
type EmployeeView struct {
	ID        uuid.UUID
	FirstName string
	LastName  string
	Code      *string
}

func (e EmployeeView) FullName() string { return e.FirstName + " " + e.LastName }

// FormTemplateVersion is the template new forms are built with. A template
// change adds a version; stored forms keep theirs, so their hash still
// matches. This one is the plain layout used until the company supplies its
// templates (assets brief §8; spec, open decision 11).
const FormTemplateVersion = "2026-10-plain"

// Form is the data an assignment form shows, copied when the asset is given
// and never changed: a later plan or value change never alters it (§8).
type Form struct {
	TemplateVersion     string       `json:"template_version"`
	Kind                Kind         `json:"kind"`
	Employee            FormEmployee `json:"employee"`
	InventoryNo         string       `json:"inventory_no"`
	Category            *Category    `json:"category"`
	Name                *string      `json:"name"`
	SerialNo            *string      `json:"serial_no"`
	SimNo               *string      `json:"sim_no"`
	PhoneNo             *string      `json:"phone_no"`
	Provider            *string      `json:"provider"`
	Plan                *string      `json:"plan"`
	NonReturnValueCents int64        `json:"non_return_value_cents"`
	Currency            string       `json:"currency"`
	GivenDate           string       `json:"given_date"`
}

type FormEmployee struct {
	FirstName string  `json:"first_name"`
	LastName  string  `json:"last_name"`
	Code      *string `json:"code"`
}

// formOf builds the form for giving a to e on givenDate. a must have the
// form's data (missingFormData() == "").
func formOf(a Asset, e EmployeeView, givenDate string) Form {
	f := Form{
		TemplateVersion: FormTemplateVersion, Kind: a.Kind,
		Employee:    FormEmployee{FirstName: e.FirstName, LastName: e.LastName, Code: e.Code},
		InventoryNo: a.InventoryNo, Category: a.Category, Name: a.Name, SerialNo: a.SerialNo,
		SimNo: a.SimNo, PhoneNo: a.PhoneNo, Provider: a.Provider, Plan: a.Plan,
		Currency: a.Currency, GivenDate: givenDate,
	}
	if a.NonReturnValueCents != nil {
		f.NonReturnValueCents = *a.NonReturnValueCents
	}
	return f
}

// FormResult is a form with its document hash, for Preview Form, Print Form
// and reprinting a stored one.
type FormResult struct {
	Form         json.RawMessage `json:"form"`
	DocumentHash string          `json:"document_hash"`
}

// encode is the form's canonical JSON and its hex SHA-256. Go encodes struct
// fields in declaration order, so the encoding is deterministic.
func (f Form) encode() (json.RawMessage, string) {
	b, err := json.Marshal(f)
	if err != nil {
		panic("asset: form is not marshalable: " + err.Error()) // fixed struct of plain fields
	}
	sum := sha256.Sum256(b)
	return b, hex.EncodeToString(sum[:])
}
