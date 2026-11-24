// Package template is the Document Vault's document templates (ADR 0008
// decision 6, docs/specs/document-template-service.md): a body of blocks,
// ppe.blocks.v1, with {{field}} placeholders and fields asked of the user,
// edited as a draft and published as versions that never change.
package template

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// Format names the body's format.
const Format = "ppe.blocks.v1"

// The kinds of block.
const (
	Heading    = "heading"
	Paragraph  = "paragraph"
	List       = "list"
	Table      = "table"
	Fields     = "fields"
	Signatures = "signatures"
	PageBreak  = "page_break"
	Spacer     = "spacer"
)

// Limits, so a body stays a document and not a dump.
const (
	maxBlocks   = 500
	maxRuns     = 300
	maxRunText  = 5000
	maxItems    = 100
	maxRows     = 200
	maxCols     = 8
	maxPairs    = 50
	maxSigns    = 3
	maxSpacerPt = 200
	maxAsked    = 30
	maxLabel    = 120
	maxOptions  = 30
)

// Run is inline text: words, bold and italic or not, or a field.
type Run struct {
	Text   string `json:"text,omitempty"`
	Field  string `json:"field,omitempty"`
	Bold   bool   `json:"bold,omitempty"`
	Italic bool   `json:"italic,omitempty"`
}

// Pair is a fields block's row: a label and its value.
type Pair struct {
	Label []Run `json:"label"`
	Value []Run `json:"value"`
}

// Signature is a signature box: what is signed for, and what is written under the line.
type Signature struct {
	Label []Run `json:"label"`
	Under []Run `json:"under,omitempty"`
}

// Block is one block of the body; which parts it uses depends on its Type.
type Block struct {
	Type string `json:"type"`
	// Level is a heading's, 1 to 3.
	Level int `json:"level,omitempty"`
	// Align is a paragraph's: left (the default), center or justify.
	Align string `json:"align,omitempty"`
	// Text is a heading's or paragraph's.
	Text []Run `json:"text,omitempty"`
	// Ordered and Items are a list's.
	Ordered bool    `json:"ordered,omitempty"`
	Items   [][]Run `json:"items,omitempty"`
	// Rows, Header and Widths are a table's: rows of cells; the first row a
	// header or not; each column's share of the width.
	Rows   [][][]Run `json:"rows,omitempty"`
	Header bool      `json:"header,omitempty"`
	Widths []int     `json:"widths,omitempty"`
	// Pairs are a fields block's.
	Pairs []Pair `json:"pairs,omitempty"`
	// Signatures are a signatures block's.
	Signatures []Signature `json:"signatures,omitempty"`
	// Height is a spacer's, in points.
	Height int `json:"height,omitempty"`
}

// Body is a template's text: ppe.blocks.v1.
type Body struct {
	Format string  `json:"format"`
	Blocks []Block `json:"blocks"`
}

// Asked kinds.
const (
	AskText     = "text"
	AskLongText = "long_text"
	AskDate     = "date"
	AskNumber   = "number"
	AskMoney    = "money"
	AskChoice   = "choice"
)

// Asked is a field the template asks for when a document is generated:
// {{input.<key>}}.
type Asked struct {
	Key      string   `json:"key"`
	Label    string   `json:"label"`
	Kind     string   `json:"kind"`
	Required bool     `json:"required"`
	Options  []string `json:"options,omitempty"`
}

// DecodeBody reads raw as a body, refusing unknown keys.
func DecodeBody(raw []byte) (Body, error) {
	var b Body
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&b); err != nil {
		return Body{}, fieldError("body", "is not "+Format+": "+err.Error())
	}
	return b, nil
}

var askedKey = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

// CheckAsked checks the asked fields: keys of their own, labels, kinds, a
// choice's options.
func CheckAsked(asked []Asked) error {
	if len(asked) > maxAsked {
		return fieldError("asked", "are too many")
	}
	var keys []string
	for i, a := range asked {
		where := fmt.Sprintf("asked %d", i+1)
		switch {
		case !askedKey.MatchString(a.Key):
			return fieldError(where, "needs a key of small letters, digits and _")
		case slices.Contains(keys, a.Key):
			return fieldError(where, "repeats the key "+a.Key)
		case strings.TrimSpace(a.Label) == "" || utf8.RuneCountInString(a.Label) > maxLabel:
			return fieldError(where, "needs a label of at most 120 characters")
		case !slices.Contains([]string{AskText, AskLongText, AskDate, AskNumber, AskMoney, AskChoice}, a.Kind):
			return fieldError(where, "has an unknown kind")
		case a.Kind == AskChoice && (len(a.Options) < 2 || len(a.Options) > maxOptions):
			return fieldError(where, "needs 2 to 30 options")
		case a.Kind != AskChoice && len(a.Options) > 0:
			return fieldError(where, "has options but is not a choice")
		}
		for _, o := range a.Options {
			if strings.TrimSpace(o) == "" || utf8.RuneCountInString(o) > maxLabel {
				return fieldError(where, "has an empty or long option")
			}
		}
		keys = append(keys, a.Key)
	}
	return nil
}

// Check checks the body against its limits, its block kinds' parts, and that
// every field is known.
func (b Body) Check(known func(key string) bool) error {
	if b.Format != Format {
		return fieldError("body", "is not "+Format)
	}
	if len(b.Blocks) == 0 {
		return fieldError("body", "has no blocks")
	}
	if len(b.Blocks) > maxBlocks {
		return fieldError("body", "has too many blocks")
	}
	for i, bl := range b.Blocks {
		if err := bl.check(known); err != nil {
			return fmt.Errorf("block %d: %w", i+1, err)
		}
	}
	return nil
}

func (bl Block) check(known func(string) bool) error {
	runs := func(rs []Run) error { return checkRuns(rs, known) }
	switch bl.Type {
	case Heading:
		if bl.Level < 1 || bl.Level > 3 {
			return fieldError("heading", "needs a level 1 to 3")
		}
		return runs(bl.Text)
	case Paragraph:
		if !slices.Contains([]string{"", "left", "center", "justify"}, bl.Align) {
			return fieldError("paragraph", "has an unknown alignment")
		}
		return runs(bl.Text)
	case List:
		if len(bl.Items) == 0 || len(bl.Items) > maxItems {
			return fieldError("list", "needs 1 to 100 items")
		}
		for _, it := range bl.Items {
			if err := runs(it); err != nil {
				return err
			}
		}
	case Table:
		if len(bl.Rows) == 0 || len(bl.Rows) > maxRows {
			return fieldError("table", "needs 1 to 200 rows")
		}
		cols := len(bl.Rows[0])
		if cols == 0 || cols > maxCols {
			return fieldError("table", "needs 1 to 8 columns")
		}
		if len(bl.Widths) != 0 && len(bl.Widths) != cols {
			return fieldError("table", "needs a width per column")
		}
		for _, w := range bl.Widths {
			if w < 1 || w > 12 {
				return fieldError("table", "widths are parts from 1 to 12")
			}
		}
		for _, row := range bl.Rows {
			if len(row) != cols {
				return fieldError("table", "rows must have the same number of cells")
			}
			for _, cell := range row {
				if err := runs(cell); err != nil {
					return err
				}
			}
		}
	case Fields:
		if len(bl.Pairs) == 0 || len(bl.Pairs) > maxPairs {
			return fieldError("fields", "needs 1 to 50 rows")
		}
		for _, p := range bl.Pairs {
			if err := runs(p.Label); err != nil {
				return err
			}
			if err := runs(p.Value); err != nil {
				return err
			}
		}
	case Signatures:
		if len(bl.Signatures) == 0 || len(bl.Signatures) > maxSigns {
			return fieldError("signatures", "needs 1 to 3 boxes")
		}
		for _, s := range bl.Signatures {
			if err := runs(s.Label); err != nil {
				return err
			}
			if err := runs(s.Under); err != nil {
				return err
			}
		}
	case PageBreak:
	case Spacer:
		if bl.Height < 1 || bl.Height > maxSpacerPt {
			return fieldError("spacer", "needs a height of 1 to 200 points")
		}
	default:
		return fieldError("block", "has an unknown type "+bl.Type)
	}
	return nil
}

func checkRuns(rs []Run, known func(string) bool) error {
	if len(rs) > maxRuns {
		return fieldError("text", "has too many pieces")
	}
	for _, r := range rs {
		switch {
		case r.Field != "" && r.Text != "":
			return fieldError("text", "a piece is words or a field, not both")
		case r.Field != "" && !known(r.Field):
			return fieldError("text", "uses an unknown field {{"+r.Field+"}}")
		case utf8.RuneCountInString(r.Text) > maxRunText:
			return fieldError("text", "is too long")
		}
	}
	return nil
}

// Fields are the field keys the body uses, in order, once each.
func (b Body) FieldKeys() []string {
	var out []string
	add := func(rs []Run) {
		for _, r := range rs {
			if r.Field != "" && !slices.Contains(out, r.Field) {
				out = append(out, r.Field)
			}
		}
	}
	b.walk(add)
	return out
}

// walk calls f with every run list of the body, in reading order.
func (b Body) walk(f func([]Run)) {
	for _, bl := range b.Blocks {
		f(bl.Text)
		for _, it := range bl.Items {
			f(it)
		}
		for _, row := range bl.Rows {
			for _, c := range row {
				f(c)
			}
		}
		for _, p := range bl.Pairs {
			f(p.Label)
			f(p.Value)
		}
		for _, s := range bl.Signatures {
			f(s.Label)
			f(s.Under)
		}
	}
}

// PlainText is the body as words, each field's value from value, a line per
// piece of text: for search.
func (b Body) PlainText(value func(key string) string) string {
	var lines []string
	b.walk(func(rs []Run) {
		var sb strings.Builder
		for _, r := range rs {
			if r.Field != "" {
				sb.WriteString(value(r.Field))
			} else {
				sb.WriteString(r.Text)
			}
		}
		if s := strings.TrimSpace(sb.String()); s != "" {
			lines = append(lines, s)
		}
	})
	return strings.Join(lines, "\n")
}

// Hash is the SHA-256 of the body and asked fields as canonical JSON: part
// of every generated document's hash.
func Hash(b Body, asked []Asked) (string, error) {
	raw, err := json.Marshal(struct {
		Body  Body    `json:"body"`
		Asked []Asked `json:"asked"`
	}{b, asked})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
