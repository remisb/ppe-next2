// Package document is the Document Vault's documents: uploaded with their
// files, given newer versions, linked to subjects, found by search
// (docs/specs/vault-service.md). Types are internal/vault's.
package document

import (
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/vault"
)

// Length limits, in characters; the database's CHECKs hold the same.
const (
	maxTitleLen = 200
	maxNoteLen  = 500
	maxLinks    = 20
	// pageSize is how many documents a search answers at once.
	pageSize = 50
)

// Version origins (vault.versions.origin).
const (
	VersionOriginal = "original"
	VersionAdded    = "added"
)

// Document is one paper of a type, with its versions (newest first) and links.
type Document struct {
	ID           uuid.UUID    `json:"id"`
	Type         string       `json:"type"`
	Title        string       `json:"title"`
	Number       *string      `json:"number"`
	DocumentDate *string      `json:"document_date"` // YYYY-MM-DD
	ValidFrom    *string      `json:"valid_from"`
	ValidUntil   *string      `json:"valid_until"`
	Origin       vault.Origin `json:"origin"`
	Sealed       bool         `json:"sealed"`
	// Locked documents (archived or migrated) are their source's: never removed
	// or relinked by a user.
	Locked   bool     `json:"locked"`
	Requires []string `json:"-"`
	// RetainUntil is the day the retention rule removes a sealed document
	// (shredded); nil while it cannot be known (still employed) or never.
	RetainUntil *string `json:"retain_until"`
	// HoldUntil and HoldReason are a Legal Hold: no shredding or removal until the day after.
	HoldUntil  *string `json:"hold_until"`
	HoldReason *string `json:"hold_reason"`
	// TitleSealed, Key and KeyID are a sealed document's: its title sealed with
	// its data key, and the data key sealed by the master keyring.
	TitleSealed []byte `json:"-"`
	// TemplateID and TemplateVersion are a generated document's template.
	TemplateID      *uuid.UUID `json:"template_id"`
	TemplateVersion *int       `json:"template_version"`
	Key             []byte     `json:"-"`
	KeyID           int16      `json:"-"`
	Versions        []Version  `json:"versions"`
	Links           []Link     `json:"links"`
	CreatedAt       time.Time  `json:"created_at"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	UpdatedAt       time.Time  `json:"updated_at"`
	UpdatedByUserID uuid.UUID  `json:"updated_by_user_id"`
	DeletedAt       *time.Time `json:"-"`
	DeletedByUserID *uuid.UUID `json:"-"`
}

// Current is the newest version; the zero Version for a document read without them.
func (d Document) Current() Version {
	if len(d.Versions) == 0 {
		return Version{}
	}
	return d.Versions[0]
}

// Version is one state of a document, with its main file.
type Version struct {
	ID           uuid.UUID `json:"id"`
	Number       int       `json:"number"`
	Origin       string    `json:"origin"`
	DocumentHash string    `json:"document_hash"`
	Note         string    `json:"note"`
	File         File      `json:"file"`
	// TextState is what the worker made of its file (vault.version_text); pending until it runs.
	TextState string `json:"text_state"`
	// DataSealed is a sealed version's note and file name (sealedData), sealed with the document's key.
	DataSealed []byte `json:"-"`
	// Data are a generated version's values as they printed (not sealed types'); Text its words, for search.
	Data            json.RawMessage `json:"-"`
	Text            string          `json:"-"`
	CreatedAt       time.Time       `json:"created_at"`
	CreatedByUserID uuid.UUID       `json:"created_by_user_id"`
	CreatedByName   string          `json:"created_by_name"`
}

// File is the bytes a version holds, in the files store.
type File struct {
	ID          uuid.UUID `json:"id"`
	ObjectKey   string    `json:"-"`
	FileName    string    `json:"file_name"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	SHA256      string    `json:"sha256"`
	Sealed      bool      `json:"-"`
}

// Link is a subject a document is about, with its name now.
type Link struct {
	Kind     vault.SubjectKind `json:"kind"`
	ID       uuid.UUID         `json:"id"`
	Label    string            `json:"label"`
	Locked   bool              `json:"locked"`
	Requires []string          `json:"-"`
}

// LinkRef names a subject: the links a request asks for.
type LinkRef struct {
	Kind vault.SubjectKind `json:"kind"`
	ID   uuid.UUID         `json:"id"`
}

// Hit is a document as a list or search shows it.
type Hit struct {
	ID           uuid.UUID    `json:"id"`
	Type         string       `json:"type"`
	Title        string       `json:"title"`
	Number       *string      `json:"number"`
	DocumentDate *string      `json:"document_date"`
	ValidUntil   *string      `json:"valid_until"`
	Origin       vault.Origin `json:"origin"`
	Sealed       bool         `json:"sealed"`
	Versions     int          `json:"versions"`
	ContentType  string       `json:"content_type"`
	Links        []Link       `json:"links"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
}

// Page is one page of a search.
type Page struct {
	Documents []Hit `json:"documents"`
	Total     int   `json:"total"`
	Page      int   `json:"page"`
	PageSize  int   `json:"page_size"`
	// Near is true when nothing matched the words and these are near spellings.
	Near bool `json:"near"`
}

// Details are a document's editable fields: Upload sets them, Update replaces them.
type Details struct {
	Title        string
	DocumentDate *string
	ValidFrom    *string
	ValidUntil   *string
	// Links are the links the user chose; locked ones are kept whatever this says.
	Links []LinkRef
}

// Normalize trims the title and drops empty dates and repeated links.
func (p *Details) Normalize() {
	p.Title = strings.Join(strings.Fields(p.Title), " ")
	for _, d := range []**string{&p.DocumentDate, &p.ValidFrom, &p.ValidUntil} {
		if *d != nil && strings.TrimSpace(**d) == "" {
			*d = nil
		}
	}
	var links []LinkRef
	for _, l := range p.Links {
		dup := false
		for _, k := range links {
			dup = dup || k == l
		}
		if !dup {
			links = append(links, l)
		}
	}
	p.Links = links
}

// Validate normalizes p and checks it against t.
func (p *Details) Validate(t vault.Type) error {
	p.Normalize()
	switch {
	case p.Title == "":
		return fieldError("title", "is required")
	case utf8.RuneCountInString(p.Title) > maxTitleLen:
		return fieldError("title", "is too long")
	case len(p.Links) > maxLinks:
		return fieldError("links", "are too many")
	}
	dates := map[string]*string{"document_date": p.DocumentDate, "valid_from": p.ValidFrom, "valid_until": p.ValidUntil}
	parsed := map[string]time.Time{}
	for _, field := range []string{"document_date", "valid_from", "valid_until"} {
		d := dates[field]
		if d == nil {
			continue
		}
		at, err := time.Parse(time.DateOnly, *d)
		if err != nil {
			return fieldError(field, "is not a date (YYYY-MM-DD)")
		}
		parsed[field] = at
	}
	if from, ok := parsed["valid_from"]; ok {
		if until, ok := parsed["valid_until"]; ok && until.Before(from) {
			return fieldError("valid_until", "is before valid_from")
		}
	}
	for _, l := range p.Links {
		if l.ID == uuid.Nil {
			return fieldError("links", "need an id")
		}
		if !t.MayLink(l.Kind) {
			return fieldError("links", "may not include "+string(l.Kind))
		}
	}
	for _, kind := range t.Must {
		found := false
		for _, l := range p.Links {
			found = found || l.Kind == kind
		}
		if !found {
			return fieldError("links", "must include "+string(kind))
		}
	}
	return nil
}

// Query is a search: words, and filters.
type Query struct {
	Words   string
	Types   []string
	Subject *LinkRef
	Page    int // from 1
}
