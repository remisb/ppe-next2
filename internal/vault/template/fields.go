package template

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no live template with that id, or no such version.
	ErrNotFound = apperr.New(apperr.NotFound, "document_template.not_found", "document template not found")
	// ErrNoStorage: no files store, so a DOCX cannot be kept.
	ErrNoStorage = apperr.New(apperr.Unavailable, "document_template.no_storage", "document template: file storage is not set up")
	// ErrFileType: an upload that is not a Word document (.docx).
	ErrFileType = apperr.New(apperr.UnsupportedType, "document_template.file_type", "document template: the file is not a Word document (.docx)")
	// ErrTooLarge: a DOCX over 5 MB, or one that unpacks too large.
	ErrTooLarge = apperr.New(apperr.TooLarge, "document_template.too_large", "document template: the DOCX is too large")
	// ErrInvalid: the request breaks a rule; fieldError wraps it.
	ErrInvalid = apperr.New(apperr.Invalid, "document_template.invalid", "invalid document template")
	// ErrNameTaken: another live template of the type has the name.
	ErrNameTaken = apperr.New(apperr.Conflict, "document_template.name_taken", "another template of this type has that name")
	// ErrNotPublished: the template has no published version to generate with, or is retired.
	ErrNotPublished = apperr.New(apperr.Conflict, "document_template.not_published", "the template has no published version")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "document_template.actor_not_found", "acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// Field is a value the app fills in: its key, its label in the editor and
// what a missing value prints, and a sample for the editor's preview.
type Field struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Sample string `json:"sample"`
	// Date fields are written as the template's language writes a date.
	Date bool `json:"date"`
}

// AskedPrefix starts an asked field's placeholder: {{input.salary}}.
const AskedPrefix = "input."

// fields are what generation fills in from the app (docs/specs/document-template-service.md, "Fields").
var fields = []Field{
	{Key: "employee.name", Label: "Employee name", Sample: "Ona Kazlauskienė"},
	{Key: "employee.first_name", Label: "Employee first name", Sample: "Ona"},
	{Key: "employee.last_name", Label: "Employee last name", Sample: "Kazlauskienė"},
	{Key: "employee.code", Label: "Employee code", Sample: "W-002"},
	{Key: "employee.birth_date", Label: "Employee date of birth", Sample: "1990-05-17", Date: true},
	{Key: "employee.nationality", Label: "Employee nationality", Sample: "LTU"},
	{Key: "company.name", Label: "Company name", Sample: "UAB Pavyzdys"},
	{Key: "company.code", Label: "Company code", Sample: "300000001"},
	{Key: "company.vat_code", Label: "Company VAT code", Sample: "LT100000000001"},
	{Key: "company.address", Label: "Company address", Sample: "Gedimino pr. 1, LT-01103 Vilnius"},
	{Key: "employment.from", Label: "Employed from", Sample: "2026-06-01", Date: true},
	{Key: "employment.until", Label: "Employed until", Sample: "", Date: true},
	{Key: "document.number", Label: "Document number", Sample: "EC-2026-0001"},
	// The generated document's hash (its values', not its file's): a DOCX
	// template prints it, as a block template's footer does.
	{Key: "document.hash", Label: "Document hash (SHA-256)", Sample: "3f2a…"},
	{Key: "document.date", Label: "Document date", Sample: "2026-11-24", Date: true},
	{Key: "user.name", Label: "Your name", Sample: "Jonas Petraitis"},
	{Key: "today", Label: "Today", Sample: "2026-11-24", Date: true},
}

// AppFields are the fields the app fills in, in the editor's order.
func AppFields() []Field { return slices.Clone(fields) }

// fieldOf is the app's field with key.
func fieldOf(key string) (Field, bool) {
	i := slices.IndexFunc(fields, func(f Field) bool { return f.Key == key })
	if i < 0 {
		return Field{}, false
	}
	return fields[i], true
}

// Known is whether key is an app field or one of asked.
func Known(key string, asked []Asked) bool {
	if _, ok := fieldOf(key); ok {
		return true
	}
	k, ok := strings.CutPrefix(key, AskedPrefix)
	return ok && slices.ContainsFunc(asked, func(a Asked) bool { return a.Key == k })
}

// Label is what a missing value of key prints, in brackets.
func Label(key string, asked []Asked) string {
	if f, ok := fieldOf(key); ok {
		return f.Label
	}
	k, _ := strings.CutPrefix(key, AskedPrefix)
	if i := slices.IndexFunc(asked, func(a Asked) bool { return a.Key == k }); i >= 0 {
		return asked[i].Label
	}
	return key
}

// Samples are the app fields' samples and asked fields' labels, for the editor's preview.
func Samples(asked []Asked) map[string]string {
	out := map[string]string{}
	for _, f := range fields {
		out[f.Key] = f.Sample
	}
	for _, a := range asked {
		out[AskedPrefix+a.Key] = "[" + a.Label + "]"
	}
	return out
}

var months = map[string][12]string{
	"lt": {"sausio", "vasario", "kovo", "balandžio", "gegužės", "birželio", "liepos", "rugpjūčio", "rugsėjo", "spalio", "lapkričio", "gruodžio"},
	"ru": {"января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"},
	"en": {"January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"},
}

// LongDate writes day (YYYY-MM-DD) as lang does in a contract: 2026 m.
// lapkričio 24 d., 24 ноября 2026 г., 24 November 2026; anything else as it is.
func LongDate(day, lang string) string {
	t, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return day
	}
	m := months[lang][t.Month()-1]
	switch lang {
	case "lt":
		return fmt.Sprintf("%d m. %s %d d.", t.Year(), m, t.Day())
	case "ru":
		return fmt.Sprintf("%d %s %d г.", t.Day(), m, t.Year())
	}
	return fmt.Sprintf("%d %s %d", t.Day(), months["en"][t.Month()-1], t.Year())
}

// Money writes cents as lang does: 2 400,00 EUR (lt, ru) or EUR 2,400.00 (en).
func Money(cents int64, lang string) string {
	neg := cents < 0
	if neg {
		cents = -cents
	}
	whole, frac := strconv.FormatInt(cents/100, 10), fmt.Sprintf("%02d", cents%100)
	sep, dec := " ", ","
	if lang == "en" {
		sep, dec = ",", "."
	}
	var b strings.Builder
	for i, r := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			b.WriteString(sep)
		}
		b.WriteRune(r)
	}
	n := b.String() + dec + frac
	if neg {
		n = "-" + n
	}
	if lang == "en" {
		return "EUR " + n
	}
	return n + " EUR"
}

// ParseMoney reads an amount as typed (2400, 2 400,50, 2400.5) into cents.
func ParseMoney(s string) (int64, bool) {
	s = strings.NewReplacer(" ", "", " ", "", "€", "", "EUR", "", "eur", "").Replace(strings.TrimSpace(s))
	if strings.Count(s, ",") == 1 && !strings.Contains(s, ".") {
		s = strings.Replace(s, ",", ".", 1)
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || math.Abs(f) > 1e12 {
		return 0, false
	}
	return int64(math.Round(f * 100)), true
}

// Inputs checks the user's answers to asked, refusing a missing required one
// or one not of its kind, and returns them as they print in lang.
func Inputs(asked []Asked, answers map[string]string, lang string) (map[string]string, error) {
	for k := range answers {
		if !slices.ContainsFunc(asked, func(a Asked) bool { return a.Key == k }) {
			return nil, fieldError("inputs", "has an unknown field "+k)
		}
	}
	out := map[string]string{}
	for _, a := range asked {
		v := strings.TrimSpace(answers[a.Key])
		if v == "" {
			if a.Required {
				return nil, fieldError("inputs", a.Key+" is required")
			}
			out[AskedPrefix+a.Key] = ""
			continue
		}
		switch a.Kind {
		case AskText:
			if strings.ContainsAny(v, "\n\r") || len([]rune(v)) > 500 {
				return nil, fieldError("inputs", a.Key+" must be one line of at most 500 characters")
			}
		case AskLongText:
			if len([]rune(v)) > 5000 {
				return nil, fieldError("inputs", a.Key+" is too long")
			}
		case AskDate:
			if _, err := time.Parse(time.DateOnly, v); err != nil {
				return nil, fieldError("inputs", a.Key+" is not a date (YYYY-MM-DD)")
			}
			v = LongDate(v, lang)
		case AskNumber:
			if _, err := strconv.ParseFloat(strings.Replace(v, ",", ".", 1), 64); err != nil {
				return nil, fieldError("inputs", a.Key+" is not a number")
			}
		case AskMoney:
			cents, ok := ParseMoney(v)
			if !ok {
				return nil, fieldError("inputs", a.Key+" is not an amount")
			}
			v = Money(cents, lang)
		case AskChoice:
			if !slices.Contains(a.Options, v) {
				return nil, fieldError("inputs", a.Key+" is not one of its options")
			}
		}
		out[AskedPrefix+a.Key] = v
	}
	return out, nil
}

// Written is an app field's value as it prints in lang: a date long; others as they are.
func Written(key, value, lang string) string {
	if f, ok := fieldOf(key); ok && f.Date && value != "" {
		return LongDate(value, lang)
	}
	return value
}
