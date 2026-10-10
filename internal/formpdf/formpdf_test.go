package formpdf

import (
	"bytes"
	"os"
	"testing"

	"github.com/remisb/ppe-next2/internal/domain/asset"
)

func sp(s string) *string { return &s }

func sample(kind asset.Kind) asset.Form {
	return asset.Form{
		TemplateVersion: "2026-10-plain", Kind: kind,
		Employee:    asset.FormEmployee{FirstName: "Ona", LastName: "Kazlauskienė", Code: sp("0142")},
		InventoryNo: "SIM-000001", SimNo: sp("0089370011"), PhoneNo: sp("+370 612 40118"), Provider: sp("Telia"),
		Name: sp("Ноутбук Lenovo"), NonReturnValueCents: 123450, Currency: "EUR", GivenDate: "2026-10-10",
	}
}

// Lithuanian and Cyrillic need the embedded fonts: the standard ones would
// make Write fail. Both kinds draw.
func TestRender(t *testing.T) {
	for _, kind := range []asset.Kind{asset.KindSIM, asset.KindEquipment} {
		b, err := Render(sample(kind), "3f2a9c")
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		if !bytes.HasPrefix(b, []byte("%PDF-")) || len(b) < 1000 {
			t.Fatalf("%s: not a PDF (%d bytes)", kind, len(b))
		}
		if out := os.Getenv("FORMPDF_OUT"); out != "" {
			_ = os.WriteFile(out+"-"+string(kind)+".pdf", b, 0o600)
		}
	}
}

func TestEuro(t *testing.T) {
	for cents, want := range map[int64]string{0: "€0.00", 2500: "€25.00", 123450: "€1,234.50", 100000000: "€1,000,000.00"} {
		if got := Euro(cents); got != want {
			t.Errorf("Euro(%d) = %q, want %q", cents, got, want)
		}
	}
}

func TestFilename(t *testing.T) {
	if got := Filename(sample(asset.KindSIM)); got != "assignment-form-SIM-000001-2026-10-10.pdf" {
		t.Errorf("Filename = %q", got)
	}
}
