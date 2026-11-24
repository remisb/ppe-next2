package docpdf

import (
	"bytes"
	"testing"
	"time"

	"github.com/remisb/ppe-next2/internal/vault/template"
)

// contract is a body using every kind of block.
func contract() template.Body {
	t := func(s string) []template.Run { return []template.Run{{Text: s}} }
	return template.Body{Format: template.Format, Blocks: []template.Block{
		{Type: template.Heading, Level: 1, Text: []template.Run{{Text: "Darbo sutartis Nr. "}, {Field: "document.number"}}},
		{Type: template.Paragraph, Align: "justify", Text: []template.Run{{Text: "Darbdavys ", Bold: true}, {Field: "company.name"}, {Text: " ir darbuotoja ", Italic: true}, {Field: "employee.name"}}},
		{Type: template.List, Ordered: true, Items: [][]template.Run{t("Pareigos"), t("Darbo užmokestis")}},
		{Type: template.Table, Header: true, Widths: []int{2, 1}, Rows: [][][]template.Run{{t("Item"), t("Sum")}, {t("Salary"), {{Field: "input.salary"}}}}},
		{Type: template.Fields, Pairs: []template.Pair{{Label: t("Kodas"), Value: []template.Run{{Field: "company.code"}}}}},
		{Type: template.Spacer, Height: 12},
		{Type: template.PageBreak},
		{Type: template.Signatures, Signatures: []template.Signature{{Label: t("Darbdavys"), Under: t("parašas")}, {Label: t("Darbuotoja")}}},
	}}
}

func TestRenderIsDeterministic(t *testing.T) {
	value := func(k string) string {
		return map[string]string{"document.number": "EC-2026-0001", "employee.name": "Ona Kazlauskienė"}[k]
	}
	o := Options{Title: "Darbo sutartis", Footer: "Document EC-2026-0001 v1 · SHA-256 abc", PageWord: "page", OfWord: "of", Created: time.Date(2026, 11, 24, 0, 0, 0, 0, time.UTC)}
	a, err := Render(contract(), value, o)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Render(contract(), value, o)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(a, []byte("%PDF-")) || !bytes.Equal(a, b) {
		t.Fatalf("not one PDF: %d and %d bytes", len(a), len(b))
	}
	o.Footer = "PREVIEW"
	c, err := Render(contract(), value, o)
	if err != nil || bytes.Equal(a, c) {
		t.Errorf("another footer drew the same bytes: %v", err)
	}
	if err := contract().Check(func(k string) bool {
		return template.Known(k, []template.Asked{{Key: "salary", Label: "Salary", Kind: template.AskMoney}})
	}); err != nil {
		t.Errorf("the test body is not valid: %v", err)
	}
}
