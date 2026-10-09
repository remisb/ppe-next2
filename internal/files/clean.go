package files

import (
	"bytes"
	"encoding/binary"
	"errors"
)

// The types an upload may be, read from the file's first bytes, never from
// its name or the browser's word for it.
const (
	PDF  = "application/pdf"
	JPEG = "image/jpeg"
	PNG  = "image/png"
)

// ErrMalformed is a file that starts as a known type but does not hold together.
var ErrMalformed = errors.New("files: the file is damaged or not what it seems")

var pngSignature = []byte("\x89PNG\r\n\x1a\n")

// Sniff is the type b's bytes say it is: PDF, JPEG or PNG, else "".
func Sniff(b []byte) string {
	switch {
	case bytes.HasPrefix(b, []byte("%PDF-")):
		return PDF
	case bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF}):
		return JPEG
	case bytes.HasPrefix(b, pngSignature):
		return PNG
	}
	return ""
}

// Ext is the file extension of a sniffed type.
func Ext(contentType string) string {
	switch contentType {
	case PDF:
		return ".pdf"
	case JPEG:
		return ".jpg"
	case PNG:
		return ".png"
	}
	return ""
}

// Clean removes what a photo says beyond its picture: a JPEG's EXIF (the
// place and the camera), XMP, IPTC and comments, keeping only which way up it
// is; a PNG's text and EXIF chunks. A PDF is kept as it is.
func Clean(contentType string, b []byte) ([]byte, error) {
	switch contentType {
	case JPEG:
		return cleanJPEG(b)
	case PNG:
		return cleanPNG(b)
	}
	return b, nil
}

// cleanJPEG copies the segments before the image data, leaving out APP1
// (EXIF, XMP), APP13 (IPTC) and COM; the image data after SOS is copied as is.
func cleanJPEG(b []byte) ([]byte, error) {
	out := bytes.NewBuffer(make([]byte, 0, len(b)))
	out.Write(b[:2]) // SOI
	orientation := uint16(0)
	wroteOrientation := false
	i := 2
	for {
		if i+4 > len(b) || b[i] != 0xFF {
			return nil, ErrMalformed
		}
		marker := b[i+1]
		if marker == 0xFF { // fill byte
			i++
			continue
		}
		n := int(binary.BigEndian.Uint16(b[i+2:]))
		if n < 2 || i+2+n > len(b) {
			return nil, ErrMalformed
		}
		seg := b[i : i+2+n]
		switch {
		case marker == 0xE1:
			if o := exifOrientation(seg[4:]); o != 0 {
				orientation = o
			}
		case marker == 0xED || marker == 0xFE:
		default:
			// The orientation goes back where EXIF stood: just after the APP0 (JFIF) header, if any.
			if !wroteOrientation && marker != 0xE0 && orientation > 1 {
				out.Write(orientationSegment(orientation))
				wroteOrientation = true
			}
			out.Write(seg)
		}
		i += 2 + n
		if marker == 0xDA { // SOS: the image data follows to the end
			out.Write(b[i:])
			return out.Bytes(), nil
		}
	}
}

// exifOrientation reads the Orientation tag (0x0112) from an APP1 body
// ("Exif\0\0" and a TIFF header), or 0.
func exifOrientation(body []byte) uint16 {
	if !bytes.HasPrefix(body, []byte("Exif\x00\x00")) || len(body) < 14 {
		return 0
	}
	t := body[6:]
	var order binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 0
	}
	ifd := int(order.Uint32(t[4:]))
	if ifd < 8 || ifd+2 > len(t) {
		return 0
	}
	count := int(order.Uint16(t[ifd:]))
	for k := range count {
		e := ifd + 2 + 12*k
		if e+12 > len(t) {
			return 0
		}
		if order.Uint16(t[e:]) == 0x0112 && order.Uint16(t[e+2:]) == 3 {
			if o := order.Uint16(t[e+8:]); o >= 1 && o <= 8 {
				return o
			}
		}
	}
	return 0
}

// orientationSegment is an APP1 holding only the Orientation tag.
func orientationSegment(o uint16) []byte {
	body := []byte("Exif\x00\x00MM\x00\x2A\x00\x00\x00\x08")
	body = binary.BigEndian.AppendUint16(body, 1)      // one entry
	body = binary.BigEndian.AppendUint16(body, 0x0112) // Orientation
	body = binary.BigEndian.AppendUint16(body, 3)      // SHORT
	body = binary.BigEndian.AppendUint32(body, 1)      // one value
	body = binary.BigEndian.AppendUint16(body, o)      // the value, left-justified
	body = binary.BigEndian.AppendUint16(body, 0)      // padding
	body = binary.BigEndian.AppendUint32(body, 0)      // no next IFD
	seg := []byte{0xFF, 0xE1}
	seg = binary.BigEndian.AppendUint16(seg, uint16(len(body)+2))
	return append(seg, body...)
}

// cleanPNG copies every chunk but eXIf, tEXt, zTXt, iTXt and tIME.
func cleanPNG(b []byte) ([]byte, error) {
	out := bytes.NewBuffer(make([]byte, 0, len(b)))
	out.Write(pngSignature)
	i := len(pngSignature)
	for i < len(b) {
		if i+12 > len(b) {
			return nil, ErrMalformed
		}
		n := int(binary.BigEndian.Uint32(b[i:]))
		end := i + 12 + n
		if n < 0 || end > len(b) || end < i {
			return nil, ErrMalformed
		}
		switch string(b[i+4 : i+8]) {
		case "eXIf", "tEXt", "zTXt", "iTXt", "tIME":
		default:
			out.Write(b[i:end])
		}
		if string(b[i+4:i+8]) == "IEND" {
			return out.Bytes(), nil
		}
		i = end
	}
	return nil, ErrMalformed
}
