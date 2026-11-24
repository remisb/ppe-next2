// Package placeholder reads and fills text with {{field}} placeholders: Mail
// Templates' parts and Document Vault's templates (ADR 0008). There is no
// logic and nothing to escape: a placeholder is a field's key between double
// braces, spaces inside ignored ({{ employee.name }}).
package placeholder

import (
	"errors"
	"fmt"
	"strings"
)

var (
	// ErrUnclosed is a {{ without its }}.
	ErrUnclosed = errors.New("has a {{ without its }}")
	// ErrUnknown is a field the caller does not know; Parse wraps it with the key.
	ErrUnknown = errors.New("uses an unknown field")
)

// Segment is a piece of text: literal Text, or the key of a Field.
type Segment struct {
	Text  string
	Field string
}

// Parse splits text into literal text and fields, each of which known must
// accept: a {{ without its }} is ErrUnclosed, an unknown field ErrUnknown
// ("uses an unknown field {{key}}"); a lone }} is text.
func Parse(text string, known func(key string) bool) ([]Segment, error) {
	var out []Segment
	for text != "" {
		open := strings.Index(text, "{{")
		if open < 0 {
			out = append(out, Segment{Text: text})
			break
		}
		if open > 0 {
			out = append(out, Segment{Text: text[:open]})
		}
		rest := text[open+2:]
		end := strings.Index(rest, "}}")
		if end < 0 || strings.Contains(rest[:end], "{{") {
			return nil, ErrUnclosed
		}
		key := strings.TrimSpace(rest[:end])
		if !known(key) {
			return nil, fmt.Errorf("%w {{%s}}", ErrUnknown, key)
		}
		out = append(out, Segment{Field: key})
		text = rest[end+2:]
	}
	return out, nil
}

// Render joins segs, each field's value from value.
func Render(segs []Segment, value func(key string) string) string {
	var b strings.Builder
	for _, s := range segs {
		if s.Field == "" {
			b.WriteString(s.Text)
			continue
		}
		b.WriteString(value(s.Field))
	}
	return b.String()
}
