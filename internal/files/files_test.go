package files

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func picture() image.Image {
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for x := range 8 {
		img.Set(x, x, color.RGBA{R: 200, A: 255})
	}
	return img
}

// exifWithGPS is an APP1 with an Orientation and a made-up GPS block, as a phone writes it.
func exifWithGPS(orientation uint16) []byte {
	tiff := []byte("II\x2A\x00\x08\x00\x00\x00")
	tiff = binary.LittleEndian.AppendUint16(tiff, 1)
	tiff = binary.LittleEndian.AppendUint16(tiff, 0x0112)
	tiff = binary.LittleEndian.AppendUint16(tiff, 3)
	tiff = binary.LittleEndian.AppendUint32(tiff, 1)
	tiff = binary.LittleEndian.AppendUint16(tiff, orientation)
	tiff = append(tiff, 0, 0, 0, 0, 0, 0)
	tiff = append(tiff, []byte("GPS 54.6872N 25.2797E iPhone 15")...)
	body := append([]byte("Exif\x00\x00"), tiff...)
	seg := []byte{0xFF, 0xE1}
	seg = binary.BigEndian.AppendUint16(seg, uint16(len(body)+2))
	return append(seg, body...)
}

func TestCleanJPEGDropsMetadataButKeepsOrientation(t *testing.T) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, picture(), nil); err != nil {
		t.Fatal(err)
	}
	plain := buf.Bytes()
	comment := []byte{0xFF, 0xFE, 0x00, 0x0A, 'S', 'e', 'c', 'r', 'e', 't', '!', '!'}
	photo := append(append(append([]byte{}, plain[:2]...), exifWithGPS(6)...), append(comment, plain[2:]...)...)
	if Sniff(photo) != JPEG {
		t.Fatalf("sniff = %q", Sniff(photo))
	}
	out, err := Clean(JPEG, photo)
	if err != nil {
		t.Fatal(err)
	}
	for _, leak := range []string{"GPS", "iPhone", "Secret"} {
		if bytes.Contains(out, []byte(leak)) {
			t.Errorf("%q is still in the cleaned photo", leak)
		}
	}
	if o := exifOrientation(out[bytes.Index(out, []byte{0xFF, 0xE1})+4:]); o != 6 {
		t.Errorf("orientation = %d, want 6", o)
	}
	if _, err := jpeg.Decode(bytes.NewReader(out)); err != nil {
		t.Errorf("the cleaned photo does not decode: %v", err)
	}
	// A photo the right way up keeps no EXIF at all.
	upright, _ := Clean(JPEG, append(append(append([]byte{}, plain[:2]...), exifWithGPS(1)...), plain[2:]...))
	if bytes.Contains(upright, []byte("Exif")) {
		t.Error("an upright photo kept an EXIF segment")
	}
}

func chunk(kind string, data []byte) []byte {
	c := binary.BigEndian.AppendUint32(nil, uint32(len(data)))
	c = append(append(c, kind...), data...)
	return binary.BigEndian.AppendUint32(c, crc32.ChecksumIEEE(append([]byte(kind), data...)))
}

func TestCleanPNGDropsTextAndEXIF(t *testing.T) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, picture()); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	ihdrEnd := 8 + 12 + 13
	tagged := append(append(append([]byte{}, b[:ihdrEnd]...), chunk("tEXt", []byte("Author\x00Jonas"))...), b[ihdrEnd:]...)
	if Sniff(tagged) != PNG {
		t.Fatalf("sniff = %q", Sniff(tagged))
	}
	out, err := Clean(PNG, tagged)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(out, []byte("Jonas")) || !bytes.Equal(out, b) {
		t.Errorf("cleaned PNG differs from the plain one (%d vs %d bytes)", len(out), len(b))
	}
	if _, err := Clean(PNG, b[:len(b)-5]); !errors.Is(err, ErrMalformed) {
		t.Errorf("cut PNG: %v", err)
	}
}

func TestSniffAndClean(t *testing.T) {
	for in, want := range map[string]string{"%PDF-1.7\n": PDF, "<html>": "", "GIF89a": "", "": ""} {
		if got := Sniff([]byte(in)); got != want {
			t.Errorf("Sniff(%q) = %q, want %q", in, got, want)
		}
	}
	pdf := []byte("%PDF-1.7\n%%EOF")
	if out, err := Clean(PDF, pdf); err != nil || !bytes.Equal(out, pdf) {
		t.Errorf("a PDF changed: %v", err)
	}
	if _, err := Clean(JPEG, []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00}); !errors.Is(err, ErrMalformed) {
		t.Errorf("cut JPEG: %v", err)
	}
}

func TestDirStore(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	s, err := Open("file://"+root, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Put(ctx, "signed-copies/a/b.pdf", bytes.NewReader([]byte("%PDF-x")), 6, PDF); err != nil {
		t.Fatal(err)
	}
	r, err := s.Get(ctx, "signed-copies/a/b.pdf")
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(r)
	r.Close()
	if string(got) != "%PDF-x" {
		t.Errorf("read back %q", got)
	}
	if _, err := s.Get(ctx, "signed-copies/a/missing.pdf"); !errors.Is(err, ErrNotFound) {
		t.Errorf("missing key: %v", err)
	}
	if err := s.Put(ctx, "../outside", bytes.NewReader(nil), 0, PDF); err == nil {
		t.Error("a key leaving the folder was written")
	}
	if matches, _ := filepath.Glob(filepath.Join(root, "signed-copies", "a", ".upload-*")); len(matches) != 0 {
		t.Errorf("temporary files left: %v", matches)
	}
}

func TestOpen(t *testing.T) {
	if s, err := Open("", "", ""); s != nil || err != nil {
		t.Errorf("empty target = %v, %v; want no store", s, err)
	}
	s, err := Open("s3://ppe-files/prod?endpoint=fra1.digitaloceanspaces.com&region=fra1", "key", "secret")
	if err != nil || s.String() != "s3://ppe-files (fra1.digitaloceanspaces.com)" || s.(*S3).key("x") != "prod/x" {
		t.Errorf("s3 target = %v, %v", s, err)
	}
	t.Chdir(t.TempDir())
	if s, err := Open("file:.files", "", ""); err != nil || !filepath.IsAbs(s.(*Dir).root) {
		t.Errorf("relative folder = %v, %v", s, err)
	}
	for _, bad := range []string{"s3://ppe-files", "file://relative/dir", "ftp://x", "s3://k:s@b?endpoint=h"} {
		if _, err := Open(bad, "key", "secret"); err == nil {
			t.Errorf("Open(%q) accepted", bad)
		}
	}
	if _, err := Open("s3://b?endpoint=h", "", ""); err == nil {
		t.Error("s3 without keys accepted")
	}
	if err := Check("file:not-made-yet", "", ""); err != nil {
		t.Errorf("Check: %v", err)
	}
	if _, err := os.Stat("not-made-yet"); !errors.Is(err, os.ErrNotExist) {
		t.Error("Check made the folder")
	}
}
