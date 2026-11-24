// Package vault is the Document Vault (ADR 0008, docs/specs/vault-service.md):
// the organisation's documents, of types fixed in code, with their versions,
// files and links to the people and things they are about. This file is the
// type registry; the documents themselves are internal/vault/document.
//
// Nothing under internal/vault imports a domain (internal/domain/*) or
// Personnel files (internal/personnel/*): what the vault needs from them it
// declares as ports, adapted in cmd/api/wire_vault.go (imports_test.go).
package vault

import (
	"slices"

	"github.com/remisb/ppe-next2/internal/files"
)

// The vault's permissions, the same keys as role.VaultRead and role.VaultManage
// (cmd/api's tests keep them equal: the vault may not import role).
const (
	PermRead   = "vault.read"
	PermManage = "vault.manage"
)

// Origin is how a document came to be.
type Origin string

const (
	Uploaded  Origin = "uploaded"
	Generated Origin = "generated"
	Archived  Origin = "archived"
)

// SubjectKind is what a document may be linked to.
type SubjectKind string

const (
	Employee   SubjectKind = "employee"
	Company    SubjectKind = "company"
	Employment SubjectKind = "employment"
	Asset      SubjectKind = "asset"
	Order      SubjectKind = "order"
	Supplier   SubjectKind = "supplier"
)

// SubjectKinds are every kind, in the order screens offer them.
func SubjectKinds() []SubjectKind {
	return []SubjectKind{Employee, Company, Employment, Asset, Order, Supplier}
}

// Group is how screens group the types.
type Group string

const (
	GroupEmployee   Group = "employee"
	GroupEmployment Group = "employment"
	GroupAssets     Group = "assets"
	GroupWorkwear   Group = "workwear"
	GroupFinance    Group = "finance"
	GroupOther      Group = "other"
)

// MaxUploadBytes is the size limit of an uploaded file unless its type sets a lower one.
const MaxUploadBytes = 20 << 20

// Type is a document type: what a document is and the rules it follows.
// Administrators edit templates, never types.
type Type struct {
	Key   string `json:"key"`
	Group Group  `json:"group"`
	// Words are the type's names in English, Lithuanian and Russian, for search
	// only; the apps' labels are their own.
	Words string `json:"-"`
	// Sealed types' files and values are sealed with a key per document (phase 2).
	Sealed bool `json:"sealed"`
	// Read and Manage are the permissions to see and to change a document of the type.
	Read   string `json:"read"`
	Manage string `json:"manage"`
	// Links are the subject kinds a document may be linked to; Must those it
	// must be linked to, at least one of each.
	Links []SubjectKind `json:"links"`
	Must  []SubjectKind `json:"must"`
	// Origins are how a document of the type may come to be.
	Origins []Origin `json:"origins"`
	// FileTypes are the sniffed types an upload may be; MaxBytes its limit.
	FileTypes []string `json:"file_types"`
	MaxBytes  int64    `json:"max_bytes"`
	// Dated types ask for the document's date; Expiring ones for valid until.
	Dated    bool `json:"dated"`
	Expiring bool `json:"expiring"`
}

// Allows reports whether a document of t may come to be by o.
func (t Type) Allows(o Origin) bool { return slices.Contains(t.Origins, o) }

// MayLink reports whether a document of t may be linked to kind.
func (t Type) MayLink(kind SubjectKind) bool { return slices.Contains(t.Links, kind) }

var uploads = []string{files.PDF, files.JPEG, files.PNG}

// types are the types in the order screens list them. Phase 1's: none sealed,
// all uploaded (docs/specs/vault-service.md, "Document types").
var types = []Type{
	{
		Key: "employee.certificate", Group: GroupEmployee, Words: "certificate pažymėjimas sertifikatas сертификат удостоверение",
		Read: PermRead, Manage: PermManage, Links: []SubjectKind{Employee, Company}, Must: []SubjectKind{Employee},
		Origins: []Origin{Uploaded}, FileTypes: uploads, MaxBytes: MaxUploadBytes, Dated: true, Expiring: true,
	},
	{
		Key: "employee.training", Group: GroupEmployee, Words: "training mokymai instruktažas обучение инструктаж",
		Read: PermRead, Manage: PermManage, Links: []SubjectKind{Employee, Company}, Must: []SubjectKind{Employee},
		Origins: []Origin{Uploaded}, FileTypes: uploads, MaxBytes: MaxUploadBytes, Dated: true, Expiring: true,
	},
	{
		Key: "invoice", Group: GroupFinance, Words: "invoice sąskaita faktūra счёт счет фактура",
		Read: PermRead, Manage: PermManage, Links: []SubjectKind{Supplier, Company, Asset, Employee},
		Origins: []Origin{Uploaded}, FileTypes: uploads, MaxBytes: MaxUploadBytes, Dated: true,
	},
	{
		Key: "asset.document", Group: GroupAssets, Words: "asset document turtas dokumentas имущество документ",
		Read: PermRead, Manage: PermManage, Links: []SubjectKind{Asset, Supplier, Employee}, Must: []SubjectKind{Asset},
		Origins: []Origin{Uploaded}, FileTypes: uploads, MaxBytes: MaxUploadBytes, Dated: true, Expiring: true,
	},
	{
		Key: "other", Group: GroupOther, Words: "other document kita dokumentas другое документ",
		Read: PermRead, Manage: PermManage, Links: []SubjectKind{Employee, Company, Asset, Supplier},
		Origins: []Origin{Uploaded}, FileTypes: uploads, MaxBytes: MaxUploadBytes, Dated: true, Expiring: true,
	},
}

// Types returns every type in display order.
func Types() []Type {
	out := make([]Type, len(types))
	for i, t := range types {
		out[i] = t
		out[i].Links = slices.Clone(t.Links)
		out[i].Must = slices.Clone(t.Must)
		out[i].Origins = slices.Clone(t.Origins)
		out[i].FileTypes = slices.Clone(t.FileTypes)
		if out[i].Must == nil {
			out[i].Must = []SubjectKind{}
		}
	}
	return out
}

// TypeOf is the type with key; false for none.
func TypeOf(key string) (Type, bool) {
	for _, t := range Types() {
		if t.Key == key {
			return t, true
		}
	}
	return Type{}, false
}

// Permissions are every permission a type names, for the catalogue test.
func Permissions() []string {
	var out []string
	for _, t := range types {
		for _, p := range []string{t.Read, t.Manage} {
			if !slices.Contains(out, p) {
				out = append(out, p)
			}
		}
	}
	return out
}
