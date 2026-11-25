// Package docxtest builds small Word documents for tests: complete enough
// for LibreOffice to open (content types, relationships, a footer reference).
package docxtest

import (
	"archive/zip"
	"bytes"
)

const (
	nsW   = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`
	nsR   = `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`
	nsRel = `xmlns="http://schemas.openxmlformats.org/package/2006/relationships"`
	rel   = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
)

// Build is a DOCX: a body of paragraphs, each one run of its text, and, if
// footer is not empty, a footer of one paragraph.
func Build(paragraphs []string, footer string) []byte {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	add := func(name, data string) {
		f, _ := w.Create(name)
		_, _ = f.Write([]byte(data))
	}
	para := func(text string) string {
		var b bytes.Buffer
		_ = escape(&b, text)
		return `<w:p><w:r><w:t xml:space="preserve">` + b.String() + `</w:t></w:r></w:p>`
	}
	body := ""
	for _, p := range paragraphs {
		body += para(p)
	}
	types := `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
	sect := `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>`
	if footer != "" {
		types += `<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`
		sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>`
	}
	add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`+
		`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`+types+`</Types>`)
	add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships `+nsRel+`><Relationship Id="rId1" Type="`+rel+`officeDocument" Target="word/document.xml"/></Relationships>`)
	add("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document `+nsW+` `+nsR+`><w:body>`+body+sect+`</w:body></w:document>`)
	if footer != "" {
		add("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships `+nsRel+`><Relationship Id="rIdFooter1" Type="`+rel+`footer" Target="footer1.xml"/></Relationships>`)
		add("word/footer1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr `+nsW+` `+nsR+`>`+para(footer)+`</w:ftr>`)
	}
	_ = w.Close()
	return buf.Bytes()
}
