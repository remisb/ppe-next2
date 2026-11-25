package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/vault/docx"
	"github.com/remisb/ppe-next2/internal/vault/docx/docxtest"
	"github.com/remisb/ppe-next2/internal/vault/template"
)

// stubConverter makes a "PDF" of a DOCX's words, so a test can read what was filled.
type stubConverter struct{ fail error }

func (c stubConverter) Convert(_ context.Context, data []byte) ([]byte, error) {
	if c.fail != nil {
		return nil, c.fail
	}
	text, err := docx.Text(data, func(k string) string { return "{{" + k + "}}" })
	if err != nil {
		return nil, err
	}
	return []byte("%PDF-1.7\n" + text), nil
}

// docxTemplate is a published DOCX contract template asking for a salary.
func docxTemplate() template.Template {
	file := docxtest.Build([]string{"Darbo sutartis Nr. {{document.number}}", "{{employee.name}}, alga {{input.salary}}"},
		"SHA-256 {{document.hash}}")
	sum := sha256.Sum256(file)
	body := template.Body{Format: template.FormatDocx, Blocks: []template.Block{}, DocxSHA256: hex.EncodeToString(sum[:]),
		DocxFields: []string{"document.hash", "document.number", "employee.name", "input.salary"}}
	docxFiles[body.DocxSHA256] = file
	asked := []template.Asked{{Key: "salary", Label: "Alga", Kind: template.AskMoney, Required: true}}
	hash, _ := template.Hash(body, asked)
	one := 1
	return template.Template{ID: uuid.New(), Type: "employment.contract", Name: "Darbo sutartis", Language: "lt", Current: &one,
		Versions: []template.Version{{Number: 1, State: template.Published, Kind: template.KindDocx, Body: body, Asked: asked, BodySHA256: hash,
			Docx: &template.DocxFile{Key: "vault-templates/x.docx", Name: "sutartis.docx", Size: int64(len(file))}}}}
}

// A DOCX template: the preview and the document are renders the worker
// converts; asking for a render answers pending, then its PDF (PREVIEW for
// the number), then the document made from it, once, with the filled DOCX
// as its source, sealed as the type is; only its maker may ask.
func TestGenerateFromDocx(t *testing.T) {
	f := newSealedFixture(t)
	tpl := docxTemplate()
	WithGeneration(stubTemplates{tpl.ID: tpl}, stubPeople{company: uuid.New()}, stubUsers{})(f.svc)
	ctx := context.Background()
	req := GenerateRequest{TemplateID: tpl.ID, EmployeeID: ana, Inputs: map[string]string{"salary": "2400"}}

	p, err := f.svc.Preview(ctx, clerk, req)
	if err != nil || p.Render == nil || p.PDF != nil || len(p.ValuesHash) != 64 {
		t.Fatalf("preview = %+v, %v", p, err)
	}
	if r, err := f.svc.GetRender(ctx, clerk, *p.Render); err != nil || r.State != RenderPending {
		t.Fatalf("pending = %+v, %v", r, err)
	}
	// The worker's turn; then the PDF, PREVIEW for the number and the hash.
	WithConverter(stubConverter{})(f.svc)
	if err := f.svc.RenderDocx(ctx, *p.Render, false); err != nil {
		t.Fatal(err)
	}
	r, err := f.svc.GetRender(ctx, clerk, *p.Render)
	if err != nil || r.State != RenderDone || r.ValuesHash != p.ValuesHash || !bytes.Contains(r.PDF, []byte("Darbo sutartis Nr. PREVIEW")) ||
		!bytes.Contains(r.PDF, []byte("alga 2\u00a0400,00 EUR")) {
		t.Fatalf("preview's PDF = %+v %q, %v", r.State, r.PDF, err)
	}
	if _, err := f.svc.GetRender(ctx, Reader{ID: uuid.New(), Perms: clerk.Perms}, *p.Render); !errors.Is(err, ErrNotFound) {
		t.Errorf("another's render: %v", err)
	}
	// The render's files are sealed in the store.
	for key, b := range f.store.files {
		if strings.HasPrefix(key, "vault/renders/") && (bytes.Contains(b, []byte("PREVIEW")) || bytes.HasPrefix(b, []byte("PK"))) {
			t.Errorf("%s is stored in the clear", key)
		}
	}

	g, err := f.svc.Generate(ctx, clerk, req, p.ValuesHash)
	if err != nil || g.Render == nil || g.Document != nil {
		t.Fatalf("generate = %+v, %v", g, err)
	}
	if len(f.repo.docs) != 0 {
		t.Fatal("a document was made before its PDF")
	}
	if err := f.svc.RenderDocx(ctx, *g.Render, false); err != nil {
		t.Fatal(err)
	}
	r, err = f.svc.GetRender(ctx, clerk, *g.Render)
	if err != nil || r.State != RenderFinished || r.Document == nil {
		t.Fatalf("finished = %+v, %v", r, err)
	}
	d := *r.Document
	v := d.Current()
	if *d.Number != "EC-2026-0001" || d.Title != "Darbo sutartis EC-2026-0001" || !d.Sealed || v.Origin != VersionGenerated ||
		v.File.ContentType != "application/pdf" || v.File.FileName != "EC-2026-0001.pdf" || v.Source == nil || v.Source.ContentType != docx.ContentType {
		t.Fatalf("document = %+v, version %+v", d, v)
	}
	if !strings.Contains(v.Text, "Ana Žukauskaitė") || !strings.Contains(v.Text, "SHA-256 "+v.DocumentHash) {
		t.Errorf("text = %q", v.Text)
	}
	_, pdf, err := f.svc.OpenSealed(ctx, clerk, d.ID, 1)
	if err != nil || !bytes.Contains(pdf, []byte("Darbo sutartis Nr. EC-2026-0001")) || !bytes.Contains(pdf, []byte("SHA-256 "+v.DocumentHash)) {
		t.Fatalf("the PDF = %q, %v", pdf, err)
	}
	// Asking again answers the same document; nothing more is made.
	again, err := f.svc.GetRender(ctx, clerk, *g.Render)
	if err != nil || again.Document.ID != d.ID || len(f.repo.docs) != 1 {
		t.Errorf("again = %+v, %v, %d documents", again, err, len(f.repo.docs))
	}

	// An hour on, the upkeep clears the renders and their files.
	f.day = f.day.Add(2 * time.Hour)
	n, err := f.svc.PurgeRenders(ctx, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil || n != 2 || len(f.repo.renders) != 0 {
		t.Errorf("purged %d, %v; %d left", n, err, len(f.repo.renders))
	}
	for key := range f.store.files {
		if strings.HasPrefix(key, "vault/renders/") {
			t.Errorf("%s is left", key)
		}
	}
}

// A conversion that fails is recorded on its last attempt, and the app is told.
func TestRenderFails(t *testing.T) {
	f := newSealedFixture(t)
	tpl := docxTemplate()
	WithGeneration(stubTemplates{tpl.ID: tpl}, stubPeople{company: uuid.New()}, stubUsers{})(f.svc)
	WithConverter(stubConverter{fail: errors.New("soffice: exit status 1")})(f.svc)
	ctx := context.Background()
	p, err := f.svc.Preview(ctx, clerk, GenerateRequest{TemplateID: tpl.ID, EmployeeID: ana, Inputs: map[string]string{"salary": "1"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.RenderDocx(ctx, *p.Render, false); err == nil {
		t.Fatal("a failed conversion is no error")
	}
	if r, _ := f.svc.GetRender(ctx, clerk, *p.Render); r.State != RenderPending {
		t.Errorf("not the last attempt: %s", r.State)
	}
	_ = f.svc.RenderDocx(ctx, *p.Render, true)
	if _, err := f.svc.GetRender(ctx, clerk, *p.Render); !errors.Is(err, ErrRenderFailed) {
		t.Errorf("after the last attempt: %v", err)
	}
}

// Without the vault's key no DOCX is filled: its render would wait unsealed.
func TestDocxNeedsTheVaultKey(t *testing.T) {
	f := newFixture()
	tpl := docxTemplate()
	tpl.Type = "employment.contract"
	WithGeneration(stubTemplates{tpl.ID: tpl}, stubPeople{company: uuid.New()}, stubUsers{})(f.svc)
	if _, err := f.svc.Preview(context.Background(), clerk, GenerateRequest{TemplateID: tpl.ID, EmployeeID: ana,
		Inputs: map[string]string{"salary": "1"}}); !errors.Is(err, ErrNotConfigured) {
		t.Errorf("without keys: %v", err)
	}
}
