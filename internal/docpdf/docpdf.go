// Package docpdf draws a document template's blocks (ppe.blocks.v1,
// internal/vault/template) as an A4 PDF: headings, paragraphs, lists,
// tables, fields, signature boxes, page breaks and spacers, with each
// field's value filled in and a footer naming the document, its version
// and hash. The same input draws the same bytes: the creation date is
// passed in.
package docpdf

import (
	"bytes"
	"fmt"
	"time"

	pdf "github.com/remisb/pdf-mini"
	"github.com/remisb/pdf-mini/layout"

	"github.com/remisb/ppe-next2/internal/pdffonts"
	"github.com/remisb/ppe-next2/internal/vault/template"
)

// Options are what a document's PDF says around its body.
type Options struct {
	// Title is the PDF's own title (its metadata).
	Title string
	// Footer is printed on every page, before "page n of m": "Document
	// EC-2026-0001 v1 · SHA-256 …", or a preview's mark.
	Footer string
	// PageWord is "page" in the template's language; "of" likewise.
	PageWord, OfWord string
	// Created is the PDF's creation date.
	Created time.Time
}

var (
	ink   = pdf.Gray(0.1)
	muted = pdf.Gray(0.4)
	rule  = pdf.Gray(0.6)
)

// Render draws body with value giving each field's value as it prints.
func Render(body template.Body, value func(key string) string, o Options) ([]byte, error) {
	fonts, err := pdffonts.Go()
	if err != nil {
		return nil, err
	}
	d := drawer{fonts: fonts, value: value}
	var els []layout.Element
	for _, bl := range body.Blocks {
		els = append(els, d.block(bl)...)
	}
	doc := pdf.New(pdf.WithCreationDate(o.Created), pdf.WithInfo(pdf.Info{Title: o.Title, Creator: "PPE Document Vault"}))
	tpl := layout.Template{
		Margins: layout.Edges{Top: 56, Right: 56, Bottom: 64, Left: 64},
		Style:   layout.TextStyle{Font: fonts.Regular, Size: 10.5, LineHeight: 1.35, Color: ink},
		Footer: func(p layout.PageInfo) layout.Element {
			text := fmt.Sprintf("%s · %s %d %s %d", o.Footer, o.PageWord, p.Number, o.OfWord, p.Total)
			return layout.Text(text, layout.TextStyle{Font: fonts.Regular, Size: 7.5, Color: muted})
		},
	}
	if err := layout.Render(doc, tpl, els...); err != nil {
		return nil, fmt.Errorf("docpdf: %w", err)
	}
	var out bytes.Buffer
	if err := doc.Write(&out); err != nil {
		return nil, fmt.Errorf("docpdf: %w", err)
	}
	return out.Bytes(), nil
}

type drawer struct {
	fonts pdffonts.Family
	value func(string) string
}

// spans are runs as text in their faces, size 0 taking the paragraph's.
func (d drawer) spans(rs []template.Run, size float64) []pdf.Span {
	out := make([]pdf.Span, 0, len(rs))
	for _, r := range rs {
		text := r.Text
		if r.Field != "" {
			text = d.value(r.Field)
		}
		if text == "" {
			continue
		}
		out = append(out, pdf.Span{Text: text, Font: d.fonts.Face(r.Bold, r.Italic), Size: size})
	}
	if len(out) == 0 {
		// An empty paragraph still takes its line.
		out = append(out, pdf.Span{Text: " ", Font: d.fonts.Regular, Size: size})
	}
	return out
}

func (d drawer) para(rs []template.Run, style layout.TextStyle) *layout.Paragraph {
	p := layout.Rich(d.spans(rs, style.Size)...)
	p.Style = style
	return p
}

// gap is the room after a block.
func gap(h float64) layout.Element { return layout.Spacer{H: h} }

func (d drawer) block(bl template.Block) []layout.Element {
	switch bl.Type {
	case template.Heading:
		size := map[int]float64{1: 16, 2: 13, 3: 11}[bl.Level]
		p := d.para(bl.Text, layout.TextStyle{Font: d.fonts.Bold, Size: size, LineHeight: 1.25})
		for i := range p.Spans {
			p.Spans[i].Font = d.fonts.Face(true, p.Spans[i].Font == d.fonts.Italic || p.Spans[i].Font == d.fonts.BoldItalic)
		}
		p.KeepWithNext = true
		return []layout.Element{p, gap(6)}
	case template.Paragraph:
		style := layout.TextStyle{}
		switch bl.Align {
		case "center":
			style = style.WithAlign(pdf.AlignCenter)
		case "justify":
			style = style.WithAlign(pdf.AlignJustify)
		}
		p := d.para(bl.Text, style)
		p.Orphans, p.Widows = 2, 2
		return []layout.Element{p, gap(6)}
	case template.List:
		var rows []layout.Element
		for i, it := range bl.Items {
			marker := "•"
			if bl.Ordered {
				marker = fmt.Sprintf("%d.", i+1)
			}
			row := layout.RowOf(layout.Text(marker), d.para(it, layout.TextStyle{}))
			row.Widths = []layout.Width{layout.Pt(20), layout.Fr(1)}
			rows = append(rows, row, gap(2))
		}
		return append(rows, gap(4))
	case template.Table:
		t := &layout.Table{Padding: layout.XY(5, 3), Grid: layout.Line(0.5, rule), Outer: layout.Line(0.5, rule)}
		for _, w := range bl.Widths {
			t.Columns = append(t.Columns, layout.Fr(float64(w)))
		}
		if len(t.Columns) == 0 {
			for range bl.Rows[0] {
				t.Columns = append(t.Columns, layout.Fr(1))
			}
		}
		for i, row := range bl.Rows {
			var cells []layout.Cell
			for _, c := range row {
				style := layout.TextStyle{}
				if bl.Header && i == 0 {
					style.Font = d.fonts.Bold
				}
				cells = append(cells, layout.Cell{Content: d.para(c, style)})
			}
			t.Rows = append(t.Rows, cells)
		}
		if bl.Header {
			t.HeaderRows = 1
		}
		return []layout.Element{t, gap(8)}
	case template.Fields:
		t := &layout.Table{Columns: []layout.Width{layout.Fr(1), layout.Fr(2)}, Padding: layout.XY(0, 2)}
		for _, p := range bl.Pairs {
			t.Rows = append(t.Rows, []layout.Cell{
				{Content: d.para(p.Label, layout.TextStyle{Color: muted})},
				{Content: d.para(p.Value, layout.TextStyle{})},
			})
		}
		return []layout.Element{t, gap(8)}
	case template.Signatures:
		var boxes []layout.Element
		var cols []layout.Width
		for _, s := range bl.Signatures {
			box := layout.Col(
				d.para(s.Label, layout.TextStyle{}),
				gap(30),
				layout.Rule{Thickness: 0.6, Color: ink},
				d.para(s.Under, layout.TextStyle{Size: 8.5, Color: muted}),
			)
			boxes = append(boxes, box)
			cols = append(cols, layout.Fr(1))
		}
		row := layout.RowOf(boxes...)
		row.Widths = cols
		row.Gap = 24
		return []layout.Element{gap(10), row, gap(8)}
	case template.PageBreak:
		return []layout.Element{layout.PageBreak{}}
	case template.Spacer:
		return []layout.Element{gap(float64(bl.Height))}
	}
	return nil
}
