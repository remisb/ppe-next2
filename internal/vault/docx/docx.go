// Package docx reads and fills Word documents (.docx) used as document
// templates (ADR 0008, phase 8; docs/specs/document-template-service.md, "DOCX
// templates"): it tells a DOCX by its parts, finds its {{field}} placeholders,
// joining those Word split across runs, fills them with values, reads its
// words, and converts a filled one to PDF with LibreOffice in the worker.
//
// A placeholder is a field's key between double braces, as internal/placeholder
// reads it; it lies within one paragraph of the body, a header or a footer.
// Nothing else of the file is changed, so its layout, fonts and styles stay.
package docx

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"html"
	"io"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/remisb/ppe-next2/internal/placeholder"
)

// ContentType is a DOCX's media type (files.DOCX).
const ContentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

// Limits on what is read: a template is a few pages, and a zip that grows
// far past its size is refused, not unpacked.
const (
	MaxBytes      = 5 << 20
	maxPartBytes  = 20 << 20
	maxTotalBytes = 60 << 20
)

var (
	// ErrNotDocx is a file that is not a Word document.
	ErrNotDocx = errors.New("is not a Word document (.docx)")
	// ErrTooLarge is a file over MaxBytes, or one that unpacks too large.
	ErrTooLarge = errors.New("is too large")
	// ErrSplitPlaceholder is a {{ whose }} is in another paragraph, or none.
	ErrSplitPlaceholder = errors.New("has a {{ whose }} is not in the same paragraph")
)

// Is reports whether b is a DOCX: a zip with the main document part.
func Is(b []byte) bool {
	if !bytes.HasPrefix(b, []byte("PK\x03\x04")) {
		return false
	}
	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return false
	}
	return slices.ContainsFunc(r.File, func(f *zip.File) bool { return f.Name == "word/document.xml" })
}

// textParts are the parts whose words print: the body, headers and footers.
var textParts = regexp.MustCompile(`^word/(document|header[0-9]*|footer[0-9]*)\.xml$`)

// open reads b's zip and the text parts' bytes, by name.
func open(b []byte) (*zip.Reader, map[string][]byte, error) {
	if len(b) > MaxBytes {
		return nil, nil, ErrTooLarge
	}
	if !Is(b) {
		return nil, nil, ErrNotDocx
	}
	r, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return nil, nil, ErrNotDocx
	}
	parts := map[string][]byte{}
	var total uint64
	for _, f := range r.File {
		total += f.UncompressedSize64
		if total > maxTotalBytes {
			return nil, nil, ErrTooLarge
		}
		if !textParts.MatchString(f.Name) {
			continue
		}
		if f.UncompressedSize64 > maxPartBytes {
			return nil, nil, ErrTooLarge
		}
		rc, err := f.Open()
		if err != nil {
			return nil, nil, ErrNotDocx
		}
		data, err := io.ReadAll(io.LimitReader(rc, maxPartBytes+1))
		rc.Close()
		if err != nil || len(data) > maxPartBytes {
			return nil, nil, ErrNotDocx
		}
		parts[f.Name] = data
	}
	return r, parts, nil
}

// A run's text's opening tag (<w:t>, <w:t xml:space="preserve">, <w:t/>) and
// a paragraph's end, in a part's XML.
var (
	textOpen = regexp.MustCompile(`<w:t(?:\s[^>]*?)?(/?)>`)
	paraEnd  = regexp.MustCompile(`</w:p>`)
)

// textNodes are part's <w:t> elements in order.
func textNodes(part []byte) []node {
	var out []node
	for _, m := range textOpen.FindAllSubmatchIndex(part, -1) {
		if m[3] > m[2] { // <w:t/>: no text
			out = append(out, node{start: m[0], end: m[1], textStart: m[1], textEnd: m[1]})
			continue
		}
		close := bytes.Index(part[m[1]:], []byte("</w:t>"))
		if close < 0 {
			continue
		}
		out = append(out, node{start: m[0], end: m[1] + close + len("</w:t>"), textStart: m[1], textEnd: m[1] + close})
	}
	return out
}

// node is one <w:t> of a part: where it is, and its text as written (XML-escaped).
type node struct {
	start, end         int // the whole element
	textStart, textEnd int // its text
}

// paragraphs are part's <w:t> nodes, grouped by paragraph in order.
func paragraphs(part []byte) [][]node {
	var out [][]node
	ends := paraEnd.FindAllIndex(part, -1)
	var cur []node
	e := 0
	for _, n := range textNodes(part) {
		for e < len(ends) && ends[e][0] < n.start {
			if len(cur) > 0 {
				out = append(out, cur)
				cur = nil
			}
			e++
		}
		cur = append(cur, n)
	}
	if len(cur) > 0 {
		out = append(out, cur)
	}
	return out
}

// paragraphText is a paragraph's words as one string, unescaped.
func paragraphText(part []byte, p []node) string {
	var b strings.Builder
	for _, n := range p {
		b.WriteString(html.UnescapeString(string(part[n.textStart:n.textEnd])))
	}
	return b.String()
}

// Fields are the distinct keys of b's placeholders, sorted, each of which
// known must accept (placeholder.ErrUnknown, ErrUnclosed); a {{ whose }} is
// in another paragraph is ErrSplitPlaceholder.
func Fields(b []byte, known func(key string) bool) ([]string, error) {
	_, parts, err := open(b)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, name := range sortedNames(parts) {
		part := parts[name]
		for _, p := range paragraphs(part) {
			segs, err := placeholder.Parse(paragraphText(part, p), known)
			if errors.Is(err, placeholder.ErrUnclosed) {
				return nil, ErrSplitPlaceholder
			}
			if err != nil {
				return nil, err
			}
			for _, s := range segs {
				if s.Field != "" {
					seen[s.Field] = true
				}
			}
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out, nil
}

// Text is b's words, filled with value, a paragraph a line, for search.
func Text(b []byte, value func(key string) string) (string, error) {
	_, parts, err := open(b)
	if err != nil {
		return "", err
	}
	var out strings.Builder
	for _, name := range sortedNames(parts) {
		part := parts[name]
		for _, p := range paragraphs(part) {
			text := paragraphText(part, p)
			if segs, err := placeholder.Parse(text, func(string) bool { return true }); err == nil {
				text = placeholder.Render(segs, value)
			}
			if strings.TrimSpace(text) != "" {
				out.WriteString(text)
				out.WriteByte('\n')
			}
		}
	}
	return out.String(), nil
}

// Merge fills b's placeholders with value: each placeholder's text, joined
// from the runs Word split it into, goes into the run where it starts, and
// the rest of it leaves the runs that held it. Every other byte of the file
// stays, the zip's entries in their order.
func Merge(b []byte, value func(key string) string) ([]byte, error) {
	r, parts, err := open(b)
	if err != nil {
		return nil, err
	}
	filled := map[string][]byte{}
	for name, part := range parts {
		out, err := fillPart(part, value)
		if err != nil {
			return nil, err
		}
		filled[name] = out
	}
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, f := range r.File {
		h := f.FileHeader
		if data, ok := filled[f.Name]; ok {
			h.Method = zip.Deflate
			fw, err := w.CreateHeader(&zip.FileHeader{Name: h.Name, Method: h.Method, Modified: h.Modified, Comment: h.Comment})
			if err != nil {
				return nil, err
			}
			if _, err := fw.Write(data); err != nil {
				return nil, err
			}
			continue
		}
		fw, err := w.CreateRaw(&h)
		if err != nil {
			return nil, err
		}
		raw, err := f.OpenRaw()
		if err != nil {
			return nil, err
		}
		if _, err := io.Copy(fw, raw); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// fillPart fills one part's placeholders, paragraph by paragraph.
func fillPart(part []byte, value func(key string) string) ([]byte, error) {
	// Each node's new text, by its index in the part; nodes not here keep theirs.
	type edit struct {
		n    node
		text string
	}
	var edits []edit
	for _, p := range paragraphs(part) {
		texts := make([]string, len(p))
		for i, n := range p {
			texts[i] = html.UnescapeString(string(part[n.textStart:n.textEnd]))
		}
		joined := strings.Join(texts, "")
		if !strings.Contains(joined, "{{") {
			continue
		}
		segs, err := placeholder.Parse(joined, func(string) bool { return true })
		if err != nil {
			return nil, ErrSplitPlaceholder
		}
		// Walk the segments over the nodes: literal text stays in the nodes it
		// was in; a field's value goes where its {{ was.
		next := make([]string, len(p))
		owner := func(offset int) int {
			for i, at := 0, 0; i < len(texts); i++ {
				if offset < at+len(texts[i]) || i == len(texts)-1 {
					return i
				}
				at += len(texts[i])
			}
			return 0
		}
		offset := 0
		for _, s := range segs {
			if s.Field == "" {
				for _, r := range s.Text {
					next[owner(offset)] += string(r)
					offset += len(string(r))
				}
				continue
			}
			// The placeholder's own text as written, to know how far it reaches.
			width := strings.Index(joined[offset:], "}}") + 2
			next[owner(offset)] += value(s.Field)
			offset += width
		}
		for i, n := range p {
			if next[i] != texts[i] {
				edits = append(edits, edit{n, next[i]})
			}
		}
	}
	if len(edits) == 0 {
		return part, nil
	}
	sort.Slice(edits, func(i, j int) bool { return edits[i].n.start < edits[j].n.start })
	var out bytes.Buffer
	at := 0
	for _, e := range edits {
		out.Write(part[at:e.n.start])
		out.WriteString(`<w:t xml:space="preserve">`)
		out.WriteString(escape(e.text))
		out.WriteString(`</w:t>`)
		at = e.n.end
	}
	out.Write(part[at:])
	return out.Bytes(), nil
}

// escape writes s as XML text; a line break in a value is a space.
func escape(s string) string {
	s = strings.NewReplacer("\r\n", " ", "\n", " ", "\r", " ").Replace(s)
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func sortedNames(parts map[string][]byte) []string {
	names := make([]string, 0, len(parts))
	for n := range parts {
		names = append(names, n)
	}
	// The body first, then headers and footers.
	sort.Slice(names, func(i, j int) bool {
		if (names[i] == "word/document.xml") != (names[j] == "word/document.xml") {
			return names[i] == "word/document.xml"
		}
		return names[i] < names[j]
	})
	return names
}

// FieldError is a field a placeholder names that the caller does not know.
func FieldError(err error) (string, bool) {
	if !errors.Is(err, placeholder.ErrUnknown) {
		return "", false
	}
	msg := err.Error()
	i := strings.Index(msg, "{{")
	if i < 0 {
		return "", true
	}
	return strings.TrimSuffix(msg[i+2:], "}}"), true
}
