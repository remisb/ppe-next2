package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/docpdf"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/vault"
	"github.com/remisb/ppe-next2/internal/vault/template"
)

// Generation (phase 3, docs/specs/document-template-service.md "Generate"):
// a published template filled with an employee's, their employment's and
// company's values and the user's answers, previewed, then numbered,
// hashed, drawn as a locked PDF and kept as version 1.

const (
	// EventGenerated: a document made from a template; its type, template,
	// version and number, never a value.
	EventGenerated = "vault.document_generated"
	// VersionGenerated is a generated version's origin.
	VersionGenerated = "generated"
)

// ErrStale: a value changed after the preview; preview again.
var ErrStale = errors.New("the values changed since the preview: preview again")

// Templates is the port to the published templates.
type Templates interface {
	ForGenerate(ctx context.Context, id uuid.UUID) (template.Template, template.Version, error)
}

// Facts are what People says of an employee and one of their employments:
// the app fields' values (dates YYYY-MM-DD) and the records to link.
type Facts struct {
	Values        map[string]string
	EmployeeLabel string
	CompanyID     *uuid.UUID
	CompanyLabel  string
}

// People is the port to employees, their employments and companies.
// Facts answers ErrSubjectNotFound for an employee or employment that is not there.
type People interface {
	Facts(ctx context.Context, employee uuid.UUID, employment *uuid.UUID) (Facts, error)
}

// Users is the port to the users' names.
type Users interface {
	Name(ctx context.Context, id uuid.UUID) (string, error)
}

// WithGeneration sets what generation reads: published templates, people and users.
func WithGeneration(t Templates, p People, u Users) Option {
	return func(s *Service) { s.templates, s.people, s.users = t, p, u }
}

// GenerateRequest is Generate Document…'s choices.
type GenerateRequest struct {
	TemplateID   uuid.UUID
	EmployeeID   uuid.UUID
	EmploymentID *uuid.UUID
	Inputs       map[string]string
}

// filled is a request resolved: its template, the values as they print
// (document.number aside), their hash, and what to link.
type filled struct {
	tpl    template.Template
	ver    template.Version
	typ    vault.Type
	values map[string]string
	hash   string
	facts  Facts
	today  string
}

// pageWords are "Document", "page" and "of" in a template's language.
var pageWords = map[string][3]string{"lt": {"Dokumentas", "psl.", "iš"}, "ru": {"Документ", "стр.", "из"}, "en": {"Document", "page", "of"}}

// fill resolves req for reader.
func (s *Service) fill(ctx context.Context, reader Reader, req GenerateRequest) (filled, error) {
	if s.templates == nil || s.people == nil || s.users == nil {
		return filled{}, fmt.Errorf("vault: generation is not set up")
	}
	tpl, ver, err := s.templates.ForGenerate(ctx, req.TemplateID)
	if err != nil {
		return filled{}, err
	}
	t, err := typeFor(tpl.Type, reader)
	if err != nil {
		return filled{}, err
	}
	if t.Sealed && s.keys == nil {
		return filled{}, ErrNotConfigured
	}
	if req.EmployeeID == uuid.Nil {
		return filled{}, fieldError("employee_id", "is required")
	}
	facts, err := s.people.Facts(ctx, req.EmployeeID, req.EmploymentID)
	if err != nil {
		return filled{}, err
	}
	name, err := s.users.Name(ctx, reader.ID)
	if err != nil {
		return filled{}, err
	}
	inputs, err := template.Inputs(ver.Asked, req.Inputs, tpl.Language)
	if err != nil {
		return filled{}, fmt.Errorf("%w: %v", ErrInvalid, errors.Unwrap(err))
	}
	today := s.today()
	values := map[string]string{}
	for k, v := range facts.Values {
		values[k] = template.Written(k, v, tpl.Language)
	}
	values["user.name"] = name
	values["today"] = template.Written("today", today, tpl.Language)
	values["document.date"] = template.Written("document.date", today, tpl.Language)
	for k, v := range inputs {
		values[k] = v
	}
	raw, err := json.Marshal(struct {
		Template uuid.UUID         `json:"template_id"`
		Version  int               `json:"version"`
		Body     string            `json:"body_sha256"`
		Values   map[string]string `json:"values"`
	}{tpl.ID, ver.Number, ver.BodySHA256, values})
	if err != nil {
		return filled{}, err
	}
	sum := sha256.Sum256(raw)
	return filled{tpl: tpl, ver: ver, typ: t, values: values, hash: hex.EncodeToString(sum[:]), facts: facts, today: today}, nil
}

// value is a field's value as it prints, a missing one its label in brackets.
func (f filled) value(key string) string {
	if v := f.values[key]; v != "" {
		return v
	}
	return "[" + template.Label(key, f.ver.Asked) + "]"
}

// Preview draws the document reader would generate, PREVIEW in its footer
// and no number, and the hash of its values, which Generate must be given back.
func (s *Service) Preview(ctx context.Context, reader Reader, req GenerateRequest) ([]byte, string, error) {
	f, err := s.fill(ctx, reader, req)
	if err != nil {
		return nil, "", err
	}
	words := pageWords[f.tpl.Language]
	pdf, err := docpdf.Render(f.ver.Body, f.value, docpdf.Options{
		Title: f.tpl.Name, Footer: "PREVIEW · " + f.tpl.Name, PageWord: words[1], OfWord: words[2], Created: s.now(),
	})
	return pdf, f.hash, err
}

// formatNumber is a generated document's number: EC-2026-0001.
func formatNumber(prefix string, year, n int) string {
	return fmt.Sprintf("%s-%d-%s", prefix, year, fmt.Sprintf("%04d", n))
}

// Generate makes the document Preview showed, refusing with ErrStale when
// a value changed since (hash differs): it takes the type's next number,
// hashes the canonical values, draws the PDF with its number, version and
// hash in the footer, seals it for a sealed type, and keeps it as version 1
// (generated), linked (locked) to the employee and the company, with
// vault.document_generated, which holds no value.
func (s *Service) Generate(ctx context.Context, reader Reader, req GenerateRequest, valuesHash string) (Document, error) {
	if s.store == nil {
		return Document{}, ErrNoStorage
	}
	f, err := s.fill(ctx, reader, req)
	if err != nil {
		return Document{}, err
	}
	if f.hash != valuesHash {
		return Document{}, ErrStale
	}
	year, _ := strconv.Atoi(f.today[:4])
	n, err := s.repo.NextNumber(ctx, f.typ.Key, year)
	if err != nil {
		return Document{}, err
	}
	number := formatNumber(f.typ.NumberPrefix, year, n)
	f.values["document.number"] = number
	canonical, err := json.Marshal(struct {
		Type     string            `json:"type"`
		Template uuid.UUID         `json:"template_id"`
		Version  int               `json:"template_version"`
		Body     string            `json:"body_sha256"`
		Number   string            `json:"number"`
		Date     string            `json:"date"`
		Values   map[string]string `json:"values"`
	}{f.typ.Key, f.tpl.ID, f.ver.Number, f.ver.BodySHA256, number, f.today, f.values})
	if err != nil {
		return Document{}, err
	}
	sum := sha256.Sum256(canonical)
	docHash := hex.EncodeToString(sum[:])
	words := pageWords[f.tpl.Language]
	now := s.now()
	title := f.tpl.Name + " " + number
	pdf, err := docpdf.Render(f.ver.Body, f.value, docpdf.Options{
		Title:  title,
		Footer: fmt.Sprintf("%s %s v1 · SHA-256 %s", words[0], number, docHash), PageWord: words[1], OfWord: words[2], Created: now,
	})
	if err != nil {
		return Document{}, err
	}
	fileSum := sha256.Sum256(pdf)
	d := Document{
		ID: s.newID(), Type: f.typ.Key, Title: title, Number: &number, DocumentDate: &f.today, Origin: vault.Generated,
		TemplateID: &f.tpl.ID, TemplateVersion: &f.ver.Number,
		CreatedAt: now, CreatedByUserID: reader.ID, UpdatedAt: now, UpdatedByUserID: reader.ID,
	}
	links := []Link{{Kind: vault.Employee, ID: req.EmployeeID, Label: f.facts.EmployeeLabel, Locked: true}}
	if f.facts.CompanyID != nil && f.typ.MayLink(vault.Company) {
		links = append(links, Link{Kind: vault.Company, ID: *f.facts.CompanyID, Label: f.facts.CompanyLabel, Locked: true})
	}
	d.Requires, d.Links = requires(f.typ, links), links
	values, err := json.Marshal(f.values)
	if err != nil {
		return Document{}, err
	}
	file := File{
		ID: s.newID(), FileName: number + ".pdf", ContentType: files.PDF, SizeBytes: int64(len(pdf)), SHA256: hex.EncodeToString(fileSum[:]),
	}
	file.ObjectKey = "vault/" + d.ID.String() + "/" + file.ID.String() + ".pdf"
	v := Version{
		ID: s.newID(), Number: 1, Origin: VersionGenerated, DocumentHash: docHash, File: file, Data: values,
		Text:      f.ver.Body.PlainText(f.value),
		CreatedAt: now, CreatedByUserID: reader.ID,
	}
	data := pdf
	if f.typ.Sealed {
		box, key, keyID, err := s.newKey(d.ID)
		if err != nil {
			return Document{}, err
		}
		d.Sealed, d.Key, d.KeyID = true, key, keyID
		if d.TitleSealed, err = box.Seal([]byte(d.Title), titleContext(d.ID)); err != nil {
			return Document{}, err
		}
		d.Title = ""
		if data, err = sealVersion(box, &v, pdf); err != nil {
			return Document{}, err
		}
	}
	d.Versions = []Version{v}
	ev, err := s.event(reader.ID, EventGenerated, d.ID, now, nil, map[string]any{
		"type": d.Type, "number": number, "template_id": f.tpl.ID, "template_version": f.ver.Number, "sha256": docHash,
	})
	if err != nil {
		return Document{}, err
	}
	if err := s.store.Put(ctx, v.File.ObjectKey, bytes.NewReader(data), int64(len(data)), files.PDF); err != nil {
		return Document{}, fmt.Errorf("vault: storing file: %w", err)
	}
	if err := s.repo.Create(ctx, d, links, ev); err != nil {
		return Document{}, err
	}
	out, err := s.repo.Get(ctx, d.ID)
	if err != nil {
		return Document{}, err
	}
	return out, s.unseal(&out)
}
