// Package mailtemplate keeps the templates of the emails the app prepares,
// one for each use case (a SIM card's activation, its blocking), and renders
// them with the values their caller fills in: a recipient, a subject and a
// body, which the user copies into their own e-mail. Nothing is sent.
//
// A template writes a field as {{key}} (spaces inside the braces are
// ignored); there is no logic and nothing to escape. A field without a value
// renders as its label in brackets, [Phone Number], as the user would write
// it, and is listed as missing.
package mailtemplate

import (
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	maxToLen      = 500
	maxCCLen      = 500
	maxSubjectLen = 300
	maxBodyLen    = 10_000
)

// Template is a use case's template as stored. UpdatedAt and UpdatedByUserID
// are nil while it has never been saved and reads as its use case's default.
type Template struct {
	Key string
	Text
	UpdatedAt       *time.Time
	UpdatedByUserID *uuid.UUID
}

// Message is a rendered template. Missing lists the keys of the fields that
// had no value, in the order they first appear.
type Message struct {
	To      string   `json:"to"`
	CC      string   `json:"cc"`
	Subject string   `json:"subject"`
	Body    string   `json:"body"`
	Missing []string `json:"missing"`
}

// TextParams are a template's new text.
type TextParams struct {
	To      string
	CC      string
	Subject string
	Body    string
}

// Normalize trims the recipient, Cc and subject, and the body's line ends and
// its trailing space.
func (p *TextParams) Normalize() {
	p.To = strings.TrimSpace(p.To)
	p.CC = strings.TrimSpace(p.CC)
	p.Subject = strings.TrimSpace(p.Subject)
	body := strings.ReplaceAll(p.Body, "\r\n", "\n")
	lines := strings.Split(body, "\n")
	for i, l := range lines {
		lines[i] = strings.TrimRight(l, " \t")
	}
	p.Body = strings.TrimRight(strings.Join(lines, "\n"), "\n")
}

// Validate checks the text against u's fields: each part but Cc is set, each
// within its limit, all but the body on one line, and every {{…}} names one
// of u's fields.
func (p *TextParams) Validate(u UseCase) error {
	p.Normalize()
	for _, part := range []struct {
		name, text string
		max        int
		oneLine    bool
		optional   bool
	}{{"to", p.To, maxToLen, true, false}, {"cc", p.CC, maxCCLen, true, true}, {"subject", p.Subject, maxSubjectLen, true, false}, {"body", p.Body, maxBodyLen, false, false}} {
		switch {
		case part.text == "" && part.optional:
			continue
		case part.text == "":
			return fieldError(part.name, "is required")
		case len(part.text) > part.max:
			return fieldError(part.name, fmt.Sprintf("is longer than %d characters", part.max))
		case part.oneLine && strings.ContainsAny(part.text, "\r\n"):
			return fieldError(part.name, "must be one line")
		}
		if _, err := parse(part.name, part.text, u); err != nil {
			return err
		}
	}
	return nil
}

func (p TextParams) text() Text { return Text{To: p.To, CC: p.CC, Subject: p.Subject, Body: p.Body} }

// segment is a piece of a template: literal text, or the key of a field.
type segment struct {
	text  string
	field string
}

// parse splits text into literal text and u's fields, naming part in its errors.
func parse(part, text string, u UseCase) ([]segment, error) {
	var out []segment
	for text != "" {
		open := strings.Index(text, "{{")
		if open < 0 {
			out = append(out, segment{text: text})
			break
		}
		if open > 0 {
			out = append(out, segment{text: text[:open]})
		}
		rest := text[open+2:]
		end := strings.Index(rest, "}}")
		if end < 0 || strings.Contains(rest[:end], "{{") {
			return nil, fieldError(part, "has a {{ without its }}")
		}
		key := strings.TrimSpace(rest[:end])
		if _, ok := u.Field(key); !ok {
			return nil, fieldError(part, fmt.Sprintf("uses an unknown field {{%s}}", key))
		}
		out = append(out, segment{field: key})
		text = rest[end+2:]
	}
	return out, nil
}

// render fills t in with values for u's fields. t must be valid for u: a
// template that is not renders as it is written.
func render(u UseCase, t Text, values map[string]string) Message {
	var missing []string
	fill := func(part, text string) string {
		segs, err := parse(part, text, u)
		if err != nil {
			return text
		}
		var b strings.Builder
		for _, s := range segs {
			if s.field == "" {
				b.WriteString(s.text)
				continue
			}
			v := strings.TrimSpace(values[s.field])
			if part != "body" {
				// A value never breaks the recipient or subject onto two lines.
				v = strings.Join(strings.Fields(v), " ")
			}
			if v == "" {
				f, _ := u.Field(s.field)
				v = "[" + f.Label + "]"
				if !slices.Contains(missing, s.field) {
					missing = append(missing, s.field)
				}
			}
			b.WriteString(v)
		}
		return b.String()
	}
	m := Message{To: fill("to", t.To), CC: fill("cc", t.CC), Subject: fill("subject", t.Subject), Body: fill("body", t.Body)}
	m.Missing = missing
	if m.Missing == nil {
		m.Missing = []string{}
	}
	return m
}

// Samples are u's fields' sample values, which the editor's preview fills in.
func Samples(u UseCase) map[string]string {
	out := make(map[string]string, len(u.Fields))
	for _, f := range u.Fields {
		out[f.Key] = f.Sample
	}
	return out
}
