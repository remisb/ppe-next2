// Package recordpdf draws an order's Items Given Record (manual §8) as an A4
// PDF, as the staff app's record (components/receipt.tsx) prints it: English /
// Russian words, the locked receipt's lines and statements, the confirmation
// once given, the signature lines and the document hash. It is drawn only
// from the record the order service builds from the snapshot, never from live
// employee or catalogue rows, so the PDF says what the hash covers. The same
// record draws the same bytes (the PDF's date is the record's own).
package recordpdf

import (
	"bytes"
	"fmt"
	"strconv"
	"time"

	pdf "github.com/remisb/pdf-mini"
	"github.com/remisb/pdf-mini/layout"

	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/formpdf"
)

var (
	muted  = pdf.Gray(0.35)
	faint  = pdf.Gray(0.5)
	rule   = pdf.Gray(0.75)
	shaded = pdf.Gray(0.92)
)

// methods are the confirmation methods as the record words them (lib/history's methodText).
var methods = map[order.Method]string{
	order.MethodElectronic: "electronically",
	order.MethodPaper:      "on paper",
	order.MethodInPerson:   "in person on a staff device",
}

// Render draws record r, its dates and times in loc (the organisation's).
func Render(r order.Record, loc *time.Location) ([]byte, error) {
	if loc == nil {
		loc = time.UTC
	}
	regular, bold, err := formpdf.Fonts()
	if err != nil {
		return nil, err
	}
	rc := r.Receipt
	o := r.Order
	given := o.Status == order.StatusGiven

	label := layout.TextStyle{Size: 8, Color: muted}
	value := layout.TextStyle{Font: bold, Size: 10.5}
	field := func(name, v string) layout.Element {
		return &layout.Box{Margin: layout.Edges{Bottom: 8}, Child: layout.Col(layout.Text(name, label), layout.Text(v, value))}
	}
	employee := rc.EmployeeFirstName + " " + rc.EmployeeLastName
	if rc.EmployeeCode != nil && *rc.EmployeeCode != "" {
		employee += " (" + *rc.EmployeeCode + ")"
	}
	dateLabel, at := "Date ordered / Дата заказа", rc.OrderedAt
	if given && o.GivenAt != nil {
		dateLabel, at = "Date given / Дата выдачи", *o.GivenAt
	}
	givenBy := "–"
	if o.GivenByName != nil && *o.GivenByName != "" {
		givenBy = *o.GivenByName
	}
	pair := func(a, b layout.Element) layout.Element {
		return &layout.Row{Gap: 24, Widths: []layout.Width{layout.Fr(1), layout.Fr(1)}, Children: []layout.Element{a, b}}
	}

	body := []layout.Element{
		layout.Text("Items Given Record / Акт выдачи", layout.TextStyle{Font: bold, Size: 15}),
		layout.Text("Record / Номер: "+rc.RecordNumber, layout.TextStyle{Size: 10, Color: muted}),
		layout.Spacer{H: 16},
		pair(field("Employee / Работник", employee), field(dateLabel, DateTime(at, loc))),
		pair(field("Given by / Выдал", givenBy), field("Prepared by / Подготовил", rc.PreparedByName)),
		layout.Spacer{H: 8},
	}

	right := layout.TextStyle{Align: pdf.AlignRight}
	head := func(s string, style ...layout.TextStyle) layout.Cell {
		c := layout.TextCell(s, style...)
		c.Style, c.Background = layout.TextStyle{Font: bold, Size: 8}, shaded
		return c
	}
	rows := [][]layout.Cell{{
		head("Item / Предмет"), head("Size / Размер"), head("Qty / Кол-во", right), head("Unit price / Цена", right),
		head("Total / Сумма", right), head("Service period / Срок службы"),
	}}
	for _, l := range rc.Lines {
		item := []layout.Element{layout.Text(l.ItemName, layout.TextStyle{Font: bold})}
		if l.ItemDetails != "" {
			item = append(item, layout.Text(l.ItemDetails, layout.TextStyle{Size: 7.5, Color: muted}))
		}
		size := "–"
		if l.Size != nil {
			size = *l.Size
		}
		rows = append(rows, []layout.Cell{
			{Content: layout.Col(item...)},
			layout.TextCell(size),
			layout.TextCell(strconv.Itoa(l.Quantity), right),
			layout.TextCell(formpdf.Euro(l.UnitPriceCents), right),
			layout.TextCell(formpdf.Euro(l.TotalCents), layout.TextStyle{Align: pdf.AlignRight, Font: bold}),
			layout.TextCell(months(l.ServicePeriodMonths)),
		})
	}
	rows = append(rows, []layout.Cell{
		// A spanning cell takes its columns: no cells stand in for them.
		{Content: layout.Text("Total value / Общая стоимость", layout.TextStyle{Font: bold, Align: pdf.AlignRight}), Colspan: 4},
		layout.TextCell(formpdf.Euro(rc.TotalCents), layout.TextStyle{Align: pdf.AlignRight, Font: bold}),
		layout.TextCell(""),
	})
	body = append(body, &layout.Table{
		Columns:    []layout.Width{layout.Fr(3), layout.Auto, layout.Auto, layout.Auto, layout.Auto, layout.Fr(1.4)},
		HeaderRows: 1,
		Rows:       rows,
		Padding:    layout.XY(4, 3),
		Grid:       layout.Line(0.3, rule),
		Outer:      layout.Line(0.5, rule),
	}, layout.Spacer{H: 14})

	statement := func(title, text string) layout.Element {
		return &layout.Box{
			Border:  layout.BorderAll(0.5, rule),
			Padding: layout.All(6),
			Child:   layout.Col(layout.Text(title, layout.TextStyle{Font: bold, Size: 9}), layout.Spacer{H: 2}, layout.Text(text, layout.TextStyle{Size: 9})),
		}
	}
	body = append(body, pair(statement(rc.TitleEN, rc.TextEN), statement(rc.TitleRU, rc.TextRU)))
	if c := r.Confirmation; c != nil && c.ConfirmedAt != nil {
		name := ""
		if c.ConfirmedName != nil {
			name = *c.ConfirmedName
		}
		body = append(body, layout.Spacer{H: 10}, layout.Rich(
			pdf.Span{Text: "Confirmed " + methods[c.Method] + " by ", Font: regular, Size: 9.5, Color: pdf.Black},
			pdf.Span{Text: name, Font: bold, Size: 9.5, Color: pdf.Black},
			pdf.Span{Text: " on " + DateTime(*c.ConfirmedAt, loc) + ".", Font: regular, Size: 9.5, Color: pdf.Black},
		))
	}

	signature := func(name, filled string) layout.Element {
		return layout.Col(
			&layout.Box{MinHeight: 26, VAlign: layout.Bottom, Border: layout.Border{Bottom: layout.Line(0.8, pdf.Black)},
				Padding: layout.Edges{Bottom: 2}, Child: layout.Text(filled, value)},
			&layout.Box{Margin: layout.Edges{Top: 3}, Child: layout.Text(name, label)},
		)
	}
	body = append(body,
		layout.Spacer{H: 30},
		&layout.Row{Gap: 24, Children: []layout.Element{
			signature("Employee name and surname / Имя и фамилия работника", rc.EmployeeFirstName+" "+rc.EmployeeLastName),
			signature("Signature / Подпись", ""),
			signature("Date / Дата", ""),
		}},
		layout.Spacer{H: 24},
		layout.Text("Document "+rc.TextVersion+" · SHA-256 "+r.DocumentHash, layout.TextStyle{Size: 6.5, Color: faint}),
	)

	doc := pdf.New(
		pdf.WithInfo(pdf.Info{Title: "Items Given Record " + rc.RecordNumber, Creator: "Workwear & Equipment"}),
		pdf.WithCreationDate(at.UTC().Truncate(time.Second)),
	)
	if err := layout.Render(doc, layout.Template{
		Size:    pdf.A4,
		Margins: layout.All(18 * pdf.MM),
		Style:   layout.TextStyle{Font: regular, Size: 9},
	}, body...); err != nil {
		return nil, fmt.Errorf("recordpdf: %w", err)
	}
	var out bytes.Buffer
	if err := doc.Write(&out); err != nil {
		return nil, fmt.Errorf("recordpdf: %w", err)
	}
	return out.Bytes(), nil
}

// Filename is the download's name: the record number.
func Filename(r order.Record) string { return "items-given-record-" + r.Receipt.RecordNumber + ".pdf" }

// DateTime writes a moment as the record prints it, in loc: "2026 10 15 14:05".
func DateTime(t time.Time, loc *time.Location) string {
	t = t.In(loc)
	return formpdf.Day(t.Format(time.DateOnly)) + " " + t.Format("15:04")
}

// months is a service period as the record words it.
func months(n int) string {
	if n == 1 {
		return "1 month"
	}
	return strconv.Itoa(n) + " months"
}
