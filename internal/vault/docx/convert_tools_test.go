//go:build tools

package docx

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/remisb/ppe-next2/internal/vault/docx/docxtest"
)

// With LibreOffice (the docworker's soffice): a filled DOCX with Lithuanian
// and Russian words becomes a PDF that says them; a cancelled conversion
// stops soffice. Run by CI's Go job after installing it.
func TestToolsConvert(t *testing.T) {
	if Version(context.Background()) == "" {
		t.Fatal("soffice is not installed")
	}
	in := docxtest.Build([]string{"Darbo sutartis Nr. {{document.number}}", "Darbuotoja {{employee.name}}"}, "SHA-256 {{document.hash}}")
	values := map[string]string{"document.number": "EC-2026-0007", "employee.name": "Ona Žukauskaitė / Анна Петрова", "document.hash": "3f2a"}
	filled, err := Merge(in, func(k string) string { return values[k] })
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	pdf, err := Converter{}.Convert(ctx, filled)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-")) {
		t.Fatalf("not a PDF: %.20q", pdf)
	}
	if _, err := exec.LookPath("pdftotext"); err == nil {
		cmd := exec.Command("pdftotext", "-", "-")
		cmd.Stdin = bytes.NewReader(pdf)
		text, err := cmd.Output()
		if err != nil {
			t.Fatal(err)
		}
		for _, want := range []string{"Darbo sutartis Nr. EC-2026-0007", "Žukauskaitė", "Петрова", "SHA-256 3f2a"} {
			if !strings.Contains(string(text), want) {
				t.Errorf("the PDF does not say %q:\n%s", want, text)
			}
		}
	}
	stopped, stop := context.WithCancel(context.Background())
	stop()
	if _, err := (Converter{}).Convert(stopped, filled); !errors.Is(err, context.Canceled) {
		t.Errorf("a cancelled conversion: %v", err)
	}
}
