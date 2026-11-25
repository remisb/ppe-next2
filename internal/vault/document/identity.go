package document

import (
	"context"
	"slices"
	"strings"
	"unicode"

	"github.com/google/uuid"
	"golang.org/x/text/unicode/norm"

	"github.com/remisb/ppe-next2/internal/vault"
)

// Identity documents (phase 7; ADR 0008 decision 5, docs/specs/vault-service.md,
// "Identity documents"): Personnel files keeps passports, ID cards and
// residence permits, sealed per person; the vault only lists them beside an
// employee's documents, metadata only, through a port. Nothing of them is
// stored, opened or downloaded here: a row opens the employee page's
// Identity section.

// maxIdentityEmployees caps how many employees a search lists identity
// documents for.
const maxIdentityEmployees = 10

// IdentityDocument is one identity document as Personnel files tells it.
// Superseded and IssuedOn are known only to a reader who may read Personnel
// files' documents (full); others see the current ones' kind, issuing state
// and expiry, as everyone signed in does on the employee page.
type IdentityDocument struct {
	ID           uuid.UUID `json:"id"`
	Kind         string    `json:"kind"`
	IssuingState string    `json:"issuing_state"`
	IssuedOn     *string   `json:"issued_on,omitempty"`
	ExpiresOn    string    `json:"expires_on"`
	Superseded   bool      `json:"superseded"`
}

// IdentityDocuments is the port to Personnel files, adapted in
// cmd/api/wire_vault.go: an employee's identity documents, all of them
// (superseded ones and issue dates) when full, else the current ones only.
type IdentityDocuments interface {
	Of(ctx context.Context, employeeID uuid.UUID, full bool) ([]IdentityDocument, error)
}

// WithIdentityDocuments lets searches list employees' identity documents.
func WithIdentityDocuments(p IdentityDocuments) Option {
	return func(s *Service) { s.identity = p }
}

// IdentityRow is an identity document in a search's answer, with its holder.
type IdentityRow struct {
	IdentityDocument
	EmployeeID uuid.UUID `json:"employee_id"`
	Holder     string    `json:"holder"`
}

// identityRows are the identity documents of the employees a search is
// about: the subject it is filtered by, else, when it has words, the
// employees linked to its hits whose names the words match (at most
// maxIdentityEmployees). Only the first page, unfiltered by type, has them.
func (s *Service) identityRows(ctx context.Context, reader Reader, q Query, hits []Hit) ([]IdentityRow, error) {
	out := make([]IdentityRow, 0)
	if s.identity == nil || q.Page > 1 || len(q.Types) > 0 {
		return out, nil
	}
	type person struct {
		id   uuid.UUID
		name string
	}
	var people []person
	add := func(id uuid.UUID, name string) {
		if len(people) < maxIdentityEmployees && !slices.ContainsFunc(people, func(p person) bool { return p.id == id }) {
			people = append(people, person{id, name})
		}
	}
	switch {
	case q.Subject != nil:
		if q.Subject.Kind != vault.Employee {
			return out, nil
		}
		name := ""
		if s.subjects != nil {
			if info, err := s.subjects.Describe(ctx, vault.Employee, q.Subject.ID); err == nil {
				name = info.Label
			}
		}
		for _, h := range hits {
			for _, l := range h.Links {
				if l.Kind == vault.Employee && l.ID == q.Subject.ID && name == "" {
					name = l.Label
				}
			}
		}
		add(q.Subject.ID, name)
	case strings.TrimSpace(q.Words) != "":
		for _, h := range hits {
			for _, l := range h.Links {
				if l.Kind == vault.Employee && NameMatches(l.Label, q.Words) {
					add(l.ID, l.Label)
				}
			}
		}
	}
	full := reader.holds(vault.PermPersonnelRead)
	for _, p := range people {
		docs, err := s.identity.Of(ctx, p.id, full)
		if err != nil {
			return nil, err
		}
		for _, d := range docs {
			out = append(out, IdentityRow{IdentityDocument: d, EmployeeID: p.id, Holder: p.name})
		}
	}
	return out, nil
}

// NameMatches says whether every word of words begins a word of name, case
// and accents aside ("zuk" matches "Žukauskaitė"), as search matches words.
func NameMatches(name, words string) bool {
	nameWords := strings.Fields(fold(name))
	ws := strings.Fields(fold(words))
	if len(ws) == 0 {
		return false
	}
	for _, w := range ws {
		if !slices.ContainsFunc(nameWords, func(n string) bool { return strings.HasPrefix(n, w) }) {
			return false
		}
	}
	return true
}

// fold lowercases s and drops its accents.
func fold(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(s)) {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
