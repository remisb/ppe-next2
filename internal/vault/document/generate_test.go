package document

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/vault"
	"github.com/remisb/ppe-next2/internal/vault/template"
)

type stubTemplates map[uuid.UUID]template.Template

func (s stubTemplates) ForGenerate(_ context.Context, id uuid.UUID) (template.Template, template.Version, error) {
	t, ok := s[id]
	if !ok {
		return template.Template{}, template.Version{}, template.ErrNotPublished
	}
	v, _ := t.Published()
	return t, v, nil
}

type stubPeople struct{ company uuid.UUID }

func (p stubPeople) Facts(_ context.Context, e uuid.UUID, _ *uuid.UUID) (Facts, error) {
	if e != ana {
		return Facts{}, ErrSubjectNotFound
	}
	return Facts{
		Values:        map[string]string{"employee.name": "Ana Žukauskaitė", "company.name": "UAB Statyba", "employment.from": "2026-06-01"},
		EmployeeLabel: "Ana Žukauskaitė", CompanyID: &p.company, CompanyLabel: "UAB Statyba",
	}, nil
}

type stubUsers struct{}

func (stubUsers) Name(context.Context, uuid.UUID) (string, error) { return "Jonas Petraitis", nil }

// contractTemplate is a published contract template asking for a salary.
func contractTemplate() template.Template {
	one := 1
	body := template.Body{Format: template.Format, Blocks: []template.Block{
		{Type: template.Heading, Level: 1, Text: []template.Run{{Text: "Darbo sutartis Nr. "}, {Field: "document.number"}}},
		{Type: template.Paragraph, Text: []template.Run{{Field: "employee.name"}, {Text: " dirbs nuo "}, {Field: "employment.from"}, {Text: ", alga "}, {Field: "input.salary"}}},
	}}
	asked := []template.Asked{{Key: "salary", Label: "Alga", Kind: template.AskMoney, Required: true}}
	sum, _ := template.Hash(body, asked)
	return template.Template{ID: uuid.New(), Type: "employment.contract", Name: "Darbo sutartis", Language: "lt", Current: &one,
		Versions: []template.Version{{Number: 1, State: template.Published, Body: body, Asked: asked, BodySHA256: sum}}}
}

func generating(t *testing.T) (*sealedFixture, template.Template) {
	f := newSealedFixture(t)
	tpl := contractTemplate()
	WithGeneration(stubTemplates{tpl.ID: tpl}, stubPeople{company: uuid.New()}, stubUsers{})(f.svc)
	return f, tpl
}

func TestGenerateAfterPreview(t *testing.T) {
	f, tpl := generating(t)
	ctx := context.Background()
	req := GenerateRequest{TemplateID: tpl.ID, EmployeeID: ana, Inputs: map[string]string{"salary": "2400"}}
	pdf, hash, err := f.svc.Preview(ctx, clerk, req)
	if err != nil || !bytes.HasPrefix(pdf, []byte("%PDF-")) || len(hash) != 64 {
		t.Fatalf("preview = %d bytes, %q, %v", len(pdf), hash, err)
	}
	if _, err := f.svc.Generate(ctx, clerk, GenerateRequest{TemplateID: tpl.ID, EmployeeID: ana, Inputs: map[string]string{"salary": "2500"}}, hash); !errors.Is(err, ErrStale) {
		t.Fatalf("another salary: %v", err)
	}
	d, err := f.svc.Generate(ctx, clerk, req, hash)
	if err != nil {
		t.Fatal(err)
	}
	if *d.Number != "EC-2026-0001" || d.Title != "Darbo sutartis EC-2026-0001" || d.Origin != vault.Generated || !d.Sealed || len(d.Links) != 2 || !d.Links[0].Locked {
		t.Fatalf("document = %+v", d)
	}
	v := d.Current()
	var values map[string]string
	if err := json.Unmarshal(v.Data, &values); err != nil || values["input.salary"] != "2 400,00 EUR" || values["employment.from"] != "2026 m. birželio 1 d." {
		t.Fatalf("values = %v %v", values, err)
	}
	if v.Origin != VersionGenerated || v.File.FileName != "EC-2026-0001.pdf" || !strings.Contains(v.Text, "Ana Žukauskaitė") {
		t.Errorf("version = %+v", v)
	}
	// Stored sealed: no values or title in the clear, none in the event.
	stored := f.repo.docs[d.ID].Versions[0]
	if stored.Data != nil || len(stored.DataSealed) == 0 || f.repo.docs[d.ID].Title != "" {
		t.Errorf("stored in the clear")
	}
	raw, _ := json.Marshal(f.repo.events)
	if strings.Contains(string(raw), "2400") || strings.Contains(string(raw), "Žukauskaitė") {
		t.Errorf("an event holds a value: %s", raw)
	}
	// The next one takes the next number.
	_, hash, _ = f.svc.Preview(ctx, clerk, req)
	if d2, err := f.svc.Generate(ctx, clerk, req, hash); err != nil || *d2.Number != "EC-2026-0002" {
		t.Errorf("second = %v %v", d2.Number, err)
	}
	// The PDF opens and is what the hash was taken of.
	if _, data, err := f.svc.OpenSealed(ctx, clerk, d.ID, 1); err != nil || !bytes.HasPrefix(data, []byte("%PDF-")) {
		t.Errorf("open = %v", err)
	}
}

func TestGenerateRefuses(t *testing.T) {
	f, tpl := generating(t)
	ctx := context.Background()
	for name, c := range map[string]struct {
		reader Reader
		req    GenerateRequest
		want   error
	}{
		"no salary":         {clerk, GenerateRequest{TemplateID: tpl.ID, EmployeeID: ana}, ErrInvalid},
		"not an amount":     {clerk, GenerateRequest{TemplateID: tpl.ID, EmployeeID: ana, Inputs: map[string]string{"salary": "a lot"}}, ErrInvalid},
		"unknown input":     {clerk, GenerateRequest{TemplateID: tpl.ID, EmployeeID: ana, Inputs: map[string]string{"salary": "1", "bonus": "1"}}, ErrInvalid},
		"no such employee":  {clerk, GenerateRequest{TemplateID: tpl.ID, EmployeeID: uuid.New(), Inputs: map[string]string{"salary": "1"}}, ErrSubjectNotFound},
		"no such template":  {clerk, GenerateRequest{TemplateID: uuid.New(), EmployeeID: ana}, template.ErrNotPublished},
		"vault.manage only": {manager, GenerateRequest{TemplateID: tpl.ID, EmployeeID: ana, Inputs: map[string]string{"salary": "1"}}, ErrInvalid},
	} {
		if _, _, err := f.svc.Preview(ctx, c.reader, c.req); !errors.Is(err, c.want) {
			t.Errorf("%s: %v, want %v", name, err, c.want)
		}
	}
}
