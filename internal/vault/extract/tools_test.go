//go:build tools

// The tools test runs the real pdftotext, pdftoppm and Tesseract (with eng,
// lit, rus and osd): `go test -tags tools ./internal/vault/extract`, in the
// docworker image or CI's tools job (docs/testing.md).
package extract

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/remisb/ppe-next2/internal/docpdf"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/vault/template"
)

func letter(t *testing.T, lines ...string) []byte {
	t.Helper()
	var blocks []template.Block
	for _, l := range lines {
		blocks = append(blocks, template.Block{Type: template.Paragraph, Text: []template.Run{{Text: l}}})
	}
	pdf, err := docpdf.Render(template.Body{Format: template.Format, Blocks: blocks}, func(string) string { return "" },
		docpdf.Options{Title: "Test", Footer: "Test", PageWord: "page", OfWord: "of", Created: time.Date(2026, 11, 25, 0, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatal(err)
	}
	return pdf
}

// picture draws the first page of pdf as a PNG, as a phone's photo would be.
func picture(t *testing.T, pdf []byte) []byte {
	t.Helper()
	dir := t.TempDir()
	in := filepath.Join(dir, "in.pdf")
	if err := os.WriteFile(in, pdf, 0o600); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("pdftoppm", "-r", "200", "-png", "-singlefile", in, filepath.Join(dir, "p")).CombinedOutput(); err != nil {
		t.Fatalf("pdftoppm: %v %s", err, out)
	}
	png, err := os.ReadFile(filepath.Join(dir, "p.png"))
	if err != nil {
		t.Fatal(err)
	}
	return png
}

// scan is a one-page PDF holding png as a JPEG picture and no text: a scan.
func scan(t *testing.T, png []byte) []byte {
	t.Helper()
	src, _, err := image.Decode(bytes.NewReader(png))
	if err != nil {
		t.Fatal(err)
	}
	// One grey channel, as the picture's colour space says.
	img := image.NewGray(src.Bounds())
	draw.Draw(img, img.Bounds(), src, src.Bounds().Min, draw.Src)
	var jb bytes.Buffer
	if err := jpeg.Encode(&jb, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	content := "q 595 0 0 842 0 0 cm /Im0 Do Q"
	var b bytes.Buffer
	var offsets []int
	obj := func(body string, stream []byte) {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s", len(offsets), body)
		if stream != nil {
			b.WriteString("\nstream\n")
			b.Write(stream)
			b.WriteString("\nendstream")
		}
		b.WriteString("\nendobj\n")
	}
	b.WriteString("%PDF-1.4\n")
	obj("<< /Type /Catalog /Pages 2 0 R >>", nil)
	obj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", nil)
	obj("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>", nil)
	obj(fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>", w, h, jb.Len()), jb.Bytes())
	obj(fmt.Sprintf("<< /Length %d >>", len(content)), []byte(content))
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(offsets)+1)
	for _, o := range offsets {
		fmt.Fprintf(&b, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets)+1, xref)
	return b.Bytes()
}

func TestToolsRead(t *testing.T) {
	ctx := context.Background()
	tools := Tools(ctx)
	if !Ready(tools) {
		t.Fatalf("tools missing: %v", tools)
	}
	lines := []string{
		"Darbo sutartis tarp bendrovės ir darbuotojos Onos Žukauskienės.",
		"Darbuotoja įsipareigoja dirbti sandėlio vadybininke ir laikytis darbo tvarkos taisyklių.",
		"Šalys susitarė dėl darbo užmokesčio, kuris mokamas kiekvieną mėnesį.",
	}
	pdf := letter(t, lines...)
	r := Reader{MaxPages: 5}

	got, err := r.Read(ctx, files.PDF, pdf)
	if err != nil {
		t.Fatal(err)
	}
	if got.Method != MethodPDFText || got.Language != "lit" || got.Pages != 1 || !strings.Contains(got.Text, "Žukauskienės") {
		t.Fatalf("PDF text: %+v", got)
	}

	png := picture(t, pdf)
	got, err = r.Read(ctx, files.PNG, png)
	if err != nil {
		t.Fatal(err)
	}
	if got.Method != MethodOCR || got.Language != "lit+eng" || !strings.Contains(strings.ToLower(got.Text), "sutartis") {
		t.Fatalf("photo: %+v", got)
	}

	got, err = r.Read(ctx, files.PDF, scan(t, png))
	if err != nil {
		t.Fatal(err)
	}
	if got.Method != MethodOCR || got.Pages != 1 || !strings.Contains(strings.ToLower(got.Text), "darbuotoja") {
		t.Fatalf("scan: %+v", got)
	}

	ru := picture(t, letter(t,
		"Трудовой договор между компанией и работником о приёме на работу.",
		"Работник обязуется выполнять обязанности кладовщика и соблюдать правила.",
		"Стороны договорились о размере заработной платы и порядке её выплаты.",
	))
	got, err = r.Read(ctx, files.PNG, ru)
	if err != nil {
		t.Fatal(err)
	}
	if got.Language != "rus+eng" || !strings.Contains(strings.ToLower(got.Text), "договор") {
		t.Fatalf("Russian photo: %+v", got)
	}

	// A job whose time is up stops its tools.
	short, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if _, err := r.Read(short, files.PDF, scan(t, png)); err == nil {
		t.Fatal("a cancelled read succeeded")
	}
	if time.Since(start) > 10*time.Second {
		t.Fatalf("cancel took %s", time.Since(start))
	}
}
