package recordpdf

import (
	"bytes"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/order"
)

func sp(s string) *string { return &s }

// sample is a given order's record, with Lithuanian and Cyrillic names.
func sample(t *testing.T) order.Record {
	t.Helper()
	ordered := time.Date(2026, 10, 14, 7, 30, 0, 0, time.UTC)
	given := time.Date(2026, 10, 15, 12, 5, 0, 0, time.UTC)
	method := order.MethodInPerson
	o := order.Order{
		ID: uuid.New(), RecordSeq: 123, EmployeeFirstName: "Ona", EmployeeLastName: "Kazlauskienė", EmployeeCode: sp("0142"),
		Status: order.StatusGiven, OrderedAt: ordered, PreparedByName: "Jonas Petraitis", GivenAt: &given,
		GivenByName: sp("Marija Žukauskaitė"), ConfirmationMethod: &method, ReceiptTextVersion: order.ReceiptTextVersion,
		Lines: []order.Line{
			{LineNo: 1, ItemName: "Куртка зимняя", ItemDetails: "Softshell, black", Size: sp("L (52–54)"), Quantity: 1,
				AccountingPriceCents: 4999, Currency: "EUR", ServicePeriodMonths: 24},
			{LineNo: 2, ItemName: "Gloves", Quantity: 3, AccountingPriceCents: 250, Currency: "EUR", ServicePeriodMonths: 1},
		},
	}
	r := order.Record{Order: o, Receipt: order.ReceiptOf(o)}
	r.DocumentHash = order.DocumentHash(r.Receipt)
	r.Confirmation = &order.Confirmation{Method: method, ConfirmedAt: &given, ConfirmedName: sp("Ona Kazlauskienė")}
	return r
}

// The record draws with the embedded fonts, and the same record draws the
// same bytes: an archived copy can be drawn again to compare.
func TestRender(t *testing.T) {
	r := sample(t)
	vilnius, err := time.LoadLocation("Europe/Vilnius")
	if err != nil {
		t.Fatal(err)
	}
	b, err := Render(r, vilnius)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(b, []byte("%PDF-")) || len(b) < 1000 {
		t.Fatalf("not a PDF (%d bytes)", len(b))
	}
	again, err := Render(r, vilnius)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(b, again) {
		t.Error("the same record drew different bytes")
	}
	if out := os.Getenv("RECORDPDF_OUT"); out != "" {
		_ = os.WriteFile(out, b, 0o600)
	}
	// Its words, where pdftotext is installed (the docworker's tools).
	if _, err := exec.LookPath("pdftotext"); err != nil {
		t.Log("pdftotext not installed: the words are not checked")
		return
	}
	cmd := exec.Command("pdftotext", "-layout", "-", "-")
	cmd.Stdin = bytes.NewReader(b)
	text, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"Items Given Record / Акт выдачи", "WE-000123", "Kazlauskienė (0142)", "2026 10 15 15:05", "Marija Žukauskaitė",
		"Куртка зимняя", "€49.99", "€7.50", "€57.49", "24 months", "1 month",
		"Confirmed in person on a staff device by", "SHA-256 " + r.DocumentHash,
	} {
		if !strings.Contains(string(text), want) {
			t.Errorf("the record does not say %q:\n%s", want, text)
		}
	}
}

func TestFilename(t *testing.T) {
	if got := Filename(sample(t)); got != "items-given-record-WE-000123.pdf" {
		t.Errorf("Filename = %q", got)
	}
}

func TestDateTime(t *testing.T) {
	vilnius, _ := time.LoadLocation("Europe/Vilnius")
	if got := DateTime(time.Date(2026, 1, 2, 22, 30, 0, 0, time.UTC), vilnius); got != "2026 01 03 00:30" {
		t.Errorf("DateTime = %q", got)
	}
}
