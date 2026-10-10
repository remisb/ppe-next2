// Package formpdf draws an asset's assignment form (assets brief §8) as an A4
// PDF, the same plain layout the web app prints (template 2026-10-plain):
// English / Russian words, the form's data, three signature lines and the
// document hash. It is drawn only from the stored or previewed form, never
// from live data, so the PDF says what the hash covers.
package formpdf

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
	"sync"

	pdf "github.com/remisb/pdf-mini"
	"github.com/remisb/pdf-mini/layout"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/goregular"

	"github.com/remisb/ppe-next2/internal/domain/asset"
)

// The Go fonts cover Latin with Lithuanian letters and Cyrillic; the PDF's
// standard fonts do not.
var fonts = sync.OnceValues(func() (*[2]*pdf.Font, error) {
	regular, err := pdf.ParseTTF(goregular.TTF)
	if err != nil {
		return nil, fmt.Errorf("formpdf: regular font: %w", err)
	}
	bold, err := pdf.ParseTTF(gobold.TTF)
	if err != nil {
		return nil, fmt.Errorf("formpdf: bold font: %w", err)
	}
	return &[2]*pdf.Font{regular, bold}, nil
})

var (
	muted = pdf.Gray(0.35)
	faint = pdf.Gray(0.5)
)

// Render draws form f with its document hash.
func Render(f asset.Form, documentHash string) ([]byte, error) {
	fs, err := fonts()
	if err != nil {
		return nil, err
	}
	regular, bold := fs[0], fs[1]
	sim := f.Kind == asset.KindSIM
	title := "Equipment Assignment Form / Акт выдачи оборудования"
	if sim {
		title = "SIM Assignment Form / Акт выдачи SIM"
	}

	employee := f.Employee.FirstName + " " + f.Employee.LastName
	if f.Employee.Code != nil && *f.Employee.Code != "" {
		employee += " (" + *f.Employee.Code + ")"
	}
	fields := [][2]string{
		{"Employee / Работник", employee},
		{"Given date / Дата выдачи", f.GivenDate},
	}
	if sim {
		fields = append(fields,
			[2]string{"SIM No. / № SIM", text(f.SimNo)},
			[2]string{"Phone No. / № телефона", text(f.PhoneNo)},
			[2]string{"Provider / Оператор", text(f.Provider)},
			[2]string{"Plan / Тариф", text(f.Plan)},
		)
	} else {
		fields = append(fields,
			[2]string{"Item / Предмет", text(f.Name)},
			[2]string{"Serial No. / Серийный №", text(f.SerialNo)},
		)
	}
	fields = append(fields, [2]string{"Non-return value / Стоимость при невозврате", Euro(f.NonReturnValueCents)})

	label := layout.TextStyle{Size: 8, Color: muted}
	value := layout.TextStyle{Font: bold, Size: 11}
	field := func(kv [2]string) layout.Element {
		return &layout.Box{Margin: layout.Edges{Bottom: 10}, Child: layout.Col(layout.Text(kv[0], label), layout.Text(kv[1], value))}
	}
	body := []layout.Element{
		layout.Text(title, layout.TextStyle{Font: bold, Size: 15}),
		layout.Text("Inventory No. / Инвентарный №: "+f.InventoryNo, layout.TextStyle{Size: 10, Color: muted}),
		layout.Spacer{H: 18},
	}
	for i := 0; i < len(fields); i += 2 {
		row := &layout.Row{Gap: 24, Widths: []layout.Width{layout.Fr(1), layout.Fr(1)}, Children: []layout.Element{field(fields[i]), layout.Spacer{}}}
		if i+1 < len(fields) {
			row.Children[1] = field(fields[i+1])
		}
		body = append(body, row)
	}
	signature := func(name, filled string) layout.Element {
		return layout.Col(
			&layout.Box{MinHeight: 26, VAlign: layout.Bottom, Border: layout.Border{Bottom: layout.Line(0.8, pdf.Black)},
				Padding: layout.Edges{Bottom: 2}, Child: layout.Text(filled, value)},
			&layout.Box{Margin: layout.Edges{Top: 3}, Child: layout.Text(name, label)},
		)
	}
	body = append(body,
		layout.Spacer{H: 36},
		&layout.Row{Gap: 24, Children: []layout.Element{
			signature("Employee signature / Подпись работника", ""),
			signature("Given by / Выдал", ""),
			signature("Date / Дата", f.GivenDate),
		}},
		layout.Spacer{H: 28},
		layout.Text("Document "+f.TemplateVersion+" · SHA-256 "+documentHash, layout.TextStyle{Size: 6.5, Color: faint}),
	)

	doc := pdf.New(pdf.WithInfo(pdf.Info{Title: title + " " + f.InventoryNo, Creator: "Workwear & Equipment"}))
	if err := layout.Render(doc, layout.Template{
		Size:    pdf.A4,
		Margins: layout.All(18 * pdf.MM),
		Style:   layout.TextStyle{Font: regular, Size: 10},
	}, body...); err != nil {
		return nil, fmt.Errorf("formpdf: %w", err)
	}
	var out bytes.Buffer
	if err := doc.Write(&out); err != nil {
		return nil, fmt.Errorf("formpdf: %w", err)
	}
	return out.Bytes(), nil
}

// Filename is the download's name: the inventory number and the given date.
func Filename(f asset.Form) string {
	return "assignment-form-" + f.InventoryNo + "-" + f.GivenDate + ".pdf"
}

func text(s *string) string {
	if s == nil || *s == "" {
		return "—"
	}
	return *s
}

// Euro writes cents as the web form does (en-IE): €1,234.50.
func Euro(cents int64) string {
	sign := ""
	if cents < 0 {
		sign, cents = "-", -cents
	}
	whole := strconv.FormatInt(cents/100, 10)
	var b strings.Builder
	for i, r := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	return fmt.Sprintf("%s€%s.%02d", sign, b.String(), cents%100)
}
