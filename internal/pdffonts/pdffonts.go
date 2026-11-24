// Package pdffonts is the fonts every printed document uses: the Go fonts,
// which cover Latin with Lithuanian letters and Cyrillic (the PDF's standard
// fonts do not), parsed once.
package pdffonts

import (
	"fmt"
	"sync"

	pdf "github.com/remisb/pdf-mini"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/gobolditalic"
	"golang.org/x/image/font/gofont/goitalic"
	"golang.org/x/image/font/gofont/goregular"
)

// Family is a font in its four faces.
type Family struct {
	Regular, Bold, Italic, BoldItalic *pdf.Font
}

// Face is the face for bold and italic.
func (f Family) Face(bold, italic bool) *pdf.Font {
	switch {
	case bold && italic:
		return f.BoldItalic
	case bold:
		return f.Bold
	case italic:
		return f.Italic
	}
	return f.Regular
}

var family = sync.OnceValues(func() (Family, error) {
	var f Family
	for _, face := range []struct {
		name string
		ttf  []byte
		dst  **pdf.Font
	}{{"regular", goregular.TTF, &f.Regular}, {"bold", gobold.TTF, &f.Bold}, {"italic", goitalic.TTF, &f.Italic}, {"bold italic", gobolditalic.TTF, &f.BoldItalic}} {
		font, err := pdf.ParseTTF(face.ttf)
		if err != nil {
			return Family{}, fmt.Errorf("pdffonts: %s: %w", face.name, err)
		}
		*face.dst = font
	}
	return f, nil
})

// Go is the Go font family.
func Go() (Family, error) { return family() }
