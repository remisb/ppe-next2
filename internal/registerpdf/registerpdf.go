// Package registerpdf draws the SIM card register as a PDF list: every card
// the register's filters match, in its order, on A4 landscape pages in a small
// type so that many rows fit a page. Each page's header names the report, when
// it was printed, the filters and the sort; the table's column headings repeat
// on every page. It is in the reader's language (their account's: en, lt or
// ru), with the staff app's words for the same things.
package registerpdf

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	pdf "github.com/remisb/pdf-mini"
	"github.com/remisb/pdf-mini/layout"

	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/formpdf"
)

var (
	muted  = pdf.Gray(0.35)
	rule   = pdf.Gray(0.75)
	shaded = pdf.Gray(0.92)
	stripe = pdf.Gray(0.97)
)

// maxSearchShown keeps a long search from pushing the header past its room.
const maxSearchShown = 60

// SIMCards draws report r, a SIM register, in lang ("en" when unknown).
func SIMCards(r asset.Report, lang string) ([]byte, error) {
	if r.Filter.Kind != asset.KindSIM {
		return nil, fmt.Errorf("registerpdf: a %s register is not a SIM card list", r.Filter.Kind)
	}
	regular, bold, err := formpdf.Fonts()
	if err != nil {
		return nil, err
	}
	w := wordsFor(lang)
	printed := w.printed + " " + formpdf.Day(r.PrintedAt.Format("2006-01-02")) + " " + r.PrintedAt.Format("15:04")
	settings := w.filters + ": " + filterText(r.Filter, w) + "  ·  " + w.sortBy + ": " + sortText(r.Filter, w) + "  ·  " + w.count(len(r.Assets))

	small := layout.TextStyle{Size: 7, Color: muted}
	header := func(p layout.PageInfo) layout.Element {
		return &layout.Box{
			Border:  layout.Border{Bottom: layout.Line(0.6, rule)},
			Padding: layout.Edges{Bottom: 3},
			Child: layout.Col(
				&layout.Row{VAlign: layout.Bottom, Widths: []layout.Width{layout.Fr(1), layout.Auto}, Children: []layout.Element{
					layout.Text(w.title, layout.TextStyle{Font: bold, Size: 11}),
					layout.Text(printed+"  ·  "+w.page(p.Number, p.Total), small.WithAlign(pdf.AlignRight)),
				}},
				&layout.Box{Margin: layout.Edges{Top: 2}, Child: layout.Text(settings, small)},
			),
		}
	}

	right := layout.TextStyle{Align: pdf.AlignRight}
	head := func(s string, style ...layout.TextStyle) layout.Cell {
		c := layout.TextCell(s, style...)
		c.Style, c.Background = layout.TextStyle{Font: bold}, shaded
		return c
	}
	rows := [][]layout.Cell{{
		head(w.colNo, right), head(w.colPhone), head(w.colSIM), head(w.colInventory), head(w.colEmployee), head(w.colProvider), head(w.colPlan),
		head(w.colStatus), head(w.colGiven), head(w.colDays, right), head(w.colDocuments), head(w.colValue, right),
	}}
	for i, a := range r.Assets {
		given, days := "–", ""
		if o := a.Open; o != nil {
			given, days = formpdf.Day(o.GivenDate), strconv.Itoa(o.DaysHeld)
		}
		value := "–"
		if a.NonReturnValueCents != nil {
			value = formpdf.Euro(*a.NonReturnValueCents)
		}
		status := "–"
		if a.ConnectionStatus != nil {
			status = w.statuses[*a.ConnectionStatus]
		}
		rows = append(rows, []layout.Cell{
			layout.TextCell(strconv.Itoa(i+1), right),
			layout.TextCell(number(a.PhoneNo)),
			layout.TextCell(number(a.SimNo)),
			layout.TextCell(keep(a.InventoryNo)),
			layout.TextCell(holder(a, w)),
			layout.TextCell(text(a.Provider)),
			layout.TextCell(text(a.Plan)),
			layout.TextCell(status),
			layout.TextCell(keep(given)),
			layout.TextCell(days, right),
			layout.TextCell(keep(documents(a.Open, w))),
			layout.TextCell(value, right),
		})
	}
	table := &layout.Table{
		// The row's number first. Numbers, dates and the documents keep to
		// one line; names and plans wrap. Days and the value are narrow, so
		// their headings wrap rather than take the room the rows need.
		Columns: []layout.Width{
			layout.Auto, layout.Auto, layout.Auto, layout.Auto, layout.Fr(2), layout.Auto, layout.Fr(1.2),
			layout.Auto, layout.Auto, layout.Pt(28), layout.Auto, layout.Pt(50),
		},
		HeaderRows: 1,
		Rows:       rows,
		Padding:    layout.XY(2.5, 1.5),
		Grid:       layout.Line(0.3, rule),
		Outer:      layout.Line(0.5, rule),
		Stripe:     stripe,
	}
	var body layout.Element = table
	if len(r.Assets) == 0 {
		body = layout.Text(w.noMatches, layout.TextStyle{Color: muted})
	}

	doc := pdf.New(pdf.WithInfo(pdf.Info{Title: w.title + " " + printed, Creator: "Workwear & Equipment"}))
	if err := layout.Render(doc, layout.Template{
		Size:        pdf.A4.Landscape(),
		Margins:     layout.Edges{Top: 21 * pdf.MM, Right: 10 * pdf.MM, Bottom: 10 * pdf.MM, Left: 10 * pdf.MM},
		HeaderInset: 8 * pdf.MM,
		Style:       layout.TextStyle{Font: regular, Size: 7, LineHeight: 1.15},
		Header:      header,
	}, body); err != nil {
		return nil, fmt.Errorf("registerpdf: %w", err)
	}
	var out bytes.Buffer
	if err := doc.Write(&out); err != nil {
		return nil, fmt.Errorf("registerpdf: %w", err)
	}
	return out.Bytes(), nil
}

// Filename is the download's name: the list and when it was printed.
func Filename(r asset.Report) string {
	return "sim-cards-" + r.PrintedAt.Format("2006-01-02-1504") + ".pdf"
}

// filterText is the filters as the register's controls set them, or none.
func filterText(f asset.ListFilter, w words) string {
	var parts []string
	switch {
	case f.Location != nil && *f.Location == asset.LocationOffice:
		parts = append(parts, w.location+": "+w.office)
	case f.Location != nil && *f.Location == asset.LocationWithEmployee, f.Held:
		parts = append(parts, w.location+": "+w.withEmployee)
	case f.Location != nil && *f.Location == asset.LocationUnknown:
		parts = append(parts, w.location+": "+w.unknown)
	}
	if f.Status != nil {
		parts = append(parts, w.status+": "+w.statuses[*f.Status])
	}
	if f.Provider != "" {
		parts = append(parts, w.provider+": "+f.Provider)
	}
	if f.NotReturned {
		parts = append(parts, w.notReturned)
	}
	if f.SignedCopyMissing {
		parts = append(parts, w.documents+": "+w.signedCopyMissing)
	}
	if f.Q != "" {
		q := f.Q
		if utf8.RuneCountInString(q) > maxSearchShown {
			q = string([]rune(q)[:maxSearchShown]) + "…"
		}
		parts = append(parts, w.search+": “"+q+"”")
	}
	if len(parts) == 0 {
		return w.none
	}
	return strings.Join(parts, ", ")
}

// sortText is the column the list is sorted by, as the register names it, and the direction.
func sortText(f asset.ListFilter, w words) string {
	label, ok := w.sorts[f.Sort]
	if !ok {
		label = w.sorts[asset.SortInventory]
	}
	if f.Desc {
		return label + ", " + w.desc
	}
	return label + ", " + w.asc
}

// holder is who holds the card or where it is, as the register shows it, and
// its Not Returned mark.
func holder(a asset.View, w words) string {
	var s string
	switch {
	case a.Open == nil || a.Location == asset.LocationOffice:
		s = w.office
	case a.Location == asset.LocationUnknown:
		s = w.unknown + " (" + w.lastHeldBy(a.Open.EmployeeName) + ")"
	default:
		s = a.Open.EmployeeName
	}
	if a.Open != nil && a.Open.NotReturnedAt != nil {
		s += " · " + w.notReturned
	}
	return s
}

// documents is the register's Documents: a signed paper form's copy, uploaded or missing.
func documents(o *asset.AssignmentView, w words) string {
	if o == nil || !o.PaperFormSigned {
		return "–"
	}
	if o.SignedCopyUploaded {
		return w.signedCopyUploaded
	}
	return w.signedCopyMissing
}

// number keeps a SIM or phone number on one line.
func number(s *string) string { return keep(text(s)) }

// keep joins s's words with no-break spaces, so it never wraps.
func keep(s string) string { return strings.ReplaceAll(s, " ", " ") }

func text(s *string) string {
	if s == nil {
		return "–"
	}
	return dash(*s)
}

func dash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "–"
	}
	return s
}
