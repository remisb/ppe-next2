package docxtest

import (
	"encoding/xml"
	"io"
)

func escape(w io.Writer, s string) error { return xml.EscapeText(w, []byte(s)) }
