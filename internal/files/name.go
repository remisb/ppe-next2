package files

import (
	"path"
	"strings"
	"unicode"
)

// Name is the name an upload is listed and downloaded under: the device's name
// without its folder or odd characters, at most 150 characters, with the
// extension of what the file really is (contentType, sniffed); fallback when
// nothing of the name is left.
func Name(name, contentType, fallback string) string {
	base := strings.TrimSuffix(path.Base(strings.ReplaceAll(name, `\`, "/")), path.Ext(name))
	var b strings.Builder
	for _, r := range base {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_' || r == '.':
			b.WriteRune(r)
		case unicode.IsSpace(r):
			b.WriteRune(' ')
		}
	}
	clean := strings.TrimSpace(b.String())
	if clean == "" || clean == "." {
		clean = fallback
	}
	if r := []rune(clean); len(r) > 150 {
		clean = string(r[:150])
	}
	return clean + Ext(contentType)
}
