package docx

import (
	"archive/zip"
	"bytes"
	"errors"
	"strings"
	"testing"

	"github.com/remisb/ppe-next2/internal/placeholder"
)

// build is a minimal DOCX whose body is body (w:p elements) and whose footer is footer.
func build(t *testing.T, body, footer string) []byte {
	t.Helper()
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	add := func(name, data string) {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		f.Write([]byte(data))
	}
	add("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`)
	add("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>`+body+`</w:body></w:document>`)
	if footer != "" {
		add("word/footer1.xml", `<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`+footer+`</w:ftr>`)
	}
	add("word/styles.xml", `<w:styles/>`)
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// A contract's paragraph as Word saves it: the placeholder split over runs
// by spelling checks and formatting, an ampersand escaped, a tab between.
const contract = `<w:p><w:r><w:t xml:space="preserve">Darbo sutartis Nr. </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>{{</w:t></w:r><w:r><w:t>document.</w:t></w:r><w:r><w:t>number}}</w:t></w:r></w:p>` +
	`<w:p><w:r><w:t>Tarp {{company.name}} &amp; </w:t><w:tab/><w:t>{{ employee.name }}</w:t></w:r></w:p>` +
	`<w:p><w:r><w:t/></w:r><w:r><w:t>Atlyginimas: {{input.salary}} EUR</w:t></w:r></w:p>`

const footer = `<w:p><w:r><w:t>{{document.number}} · SHA-256 {{document.hash}}</w:t></w:r></w:p>`

func known(key string) bool {
	return key == "document.number" || key == "document.hash" || key == "company.name" || key == "employee.name" || key == "input.salary"
}

func TestIs(t *testing.T) {
	if !Is(build(t, contract, "")) {
		t.Error("a DOCX is not one")
	}
	for name, b := range map[string][]byte{"pdf": []byte("%PDF-1.7"), "empty": nil, "a zip": zipOf(t, "a.txt")} {
		if Is(b) {
			t.Errorf("%s is a DOCX", name)
		}
	}
}

func zipOf(t *testing.T, name string) []byte {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	f, _ := w.Create(name)
	f.Write([]byte("x"))
	w.Close()
	return buf.Bytes()
}

// Fields joins placeholders Word split across runs, in the body and the footer.
func TestFields(t *testing.T) {
	got, err := Fields(build(t, contract, footer), known)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"company.name", "document.hash", "document.number", "employee.name", "input.salary"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("fields = %v, want %v", got, want)
	}
}

func TestFieldsRefuses(t *testing.T) {
	split := `<w:p><w:r><w:t>{{employee.</w:t></w:r></w:p><w:p><w:r><w:t>name}}</w:t></w:r></w:p>`
	if _, err := Fields(build(t, split, ""), known); !errors.Is(err, ErrSplitPlaceholder) {
		t.Errorf("a placeholder over two paragraphs: %v", err)
	}
	unknown := `<w:p><w:r><w:t>{{salary}}</w:t></w:r></w:p>`
	_, err := Fields(build(t, unknown, ""), known)
	if !errors.Is(err, placeholder.ErrUnknown) {
		t.Fatalf("an unknown field: %v", err)
	}
	if key, ok := FieldError(err); !ok || key != "salary" {
		t.Errorf("FieldError = %q %v", key, ok)
	}
	if _, err := Fields([]byte("%PDF-1.7"), known); !errors.Is(err, ErrNotDocx) {
		t.Errorf("a PDF: %v", err)
	}
	if _, err := Fields(bytes.Repeat([]byte{1}, MaxBytes+1), known); !errors.Is(err, ErrTooLarge) {
		t.Errorf("too large: %v", err)
	}
}

// Merge puts each value where its placeholder starts, escaped, keeps the
// literal text in its runs and its formatting, and leaves other parts as they were.
func TestMerge(t *testing.T) {
	in := build(t, contract, footer)
	values := map[string]string{
		"document.number": "EC-2026-0007", "document.hash": "3f2a", "company.name": "UAB <Rūbai> & Co",
		"employee.name": "Ona Kazlauskienė", "input.salary": "2 400,00",
	}
	out, err := Merge(in, func(k string) string { return values[k] })
	if err != nil {
		t.Fatal(err)
	}
	if !Is(out) {
		t.Fatal("the merged file is not a DOCX")
	}
	text, err := Text(out, func(k string) string { return "?" })
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Darbo sutartis Nr. EC-2026-0007", "Tarp UAB <Rūbai> & Co & Ona Kazlauskienė", "Atlyginimas: 2 400,00 EUR", "EC-2026-0007 · SHA-256 3f2a"} {
		if !strings.Contains(text, want) {
			t.Errorf("merged text lacks %q:\n%s", want, text)
		}
	}
	if fields, err := Fields(out, known); err != nil || len(fields) != 0 {
		t.Errorf("placeholders left: %v %v", fields, err)
	}
	_, parts, _ := open(out)
	doc := string(parts["word/document.xml"])
	if !strings.Contains(doc, `<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">EC-2026-0007</w:t>`) {
		t.Errorf("the number left its bold run: %s", doc)
	}
	if !strings.Contains(doc, "UAB &lt;Rūbai&gt; &amp; Co") || !strings.Contains(doc, "<w:tab/>") {
		t.Errorf("not escaped, or the tab lost: %s", doc)
	}
	// Other parts are copied as they were.
	r, _ := zip.NewReader(bytes.NewReader(out), int64(len(out)))
	names := []string{}
	for _, f := range r.File {
		names = append(names, f.Name)
	}
	if strings.Join(names, ",") != "[Content_Types].xml,word/document.xml,word/footer1.xml,word/styles.xml" {
		t.Errorf("parts = %v", names)
	}
}

// Text fills placeholders and gives a paragraph a line.
func TestText(t *testing.T) {
	text, err := Text(build(t, contract, footer), func(k string) string { return "[" + k + "]" })
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(text, "Darbo sutartis Nr. [document.number]\n") || !strings.Contains(text, "[document.hash]") {
		t.Errorf("text = %q", text)
	}
}
