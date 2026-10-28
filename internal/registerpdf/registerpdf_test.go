package registerpdf

import (
	"bytes"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/asset"
)

func sp(s string) *string { return &s }

func sample(n int) asset.Report {
	active, office := asset.StatusActive, asset.LocationOffice
	unknown := asset.WhereaboutsUnknown
	value := int64(2500)
	at := time.Date(2026, 10, 28, 14, 35, 0, 0, time.UTC)
	r := asset.Report{
		Filter:    asset.ListFilter{Kind: asset.KindSIM, Location: &office, Provider: "Telia", Q: "Kazlauskienė", Sort: asset.SortPhone, Desc: true},
		PrintedAt: at,
	}
	for i := range n {
		v := asset.View{Asset: asset.Asset{
			ID: uuid.New(), Kind: asset.KindSIM, InventoryNo: "SIM-" + strconv.Itoa(100000+i), SimNo: sp("8937 0011 " + strconv.Itoa(i)),
			PhoneNo: sp("+370 612 40118"), Provider: sp("Telia"), Plan: sp("Verslo planas 10 GB"), ConnectionStatus: &active,
			NonReturnValueCents: &value, Comment: "Ноутбук и телефон",
		}, Location: asset.LocationOffice}
		if i%2 == 0 {
			v.Location = asset.LocationWithEmployee
			v.Open = &asset.AssignmentView{Assignment: asset.Assignment{
				EmployeeName: "Ona Kazlauskienė", GivenDate: "2026-10-01", PaperFormSigned: true,
			}, DaysHeld: 27}
			if i%4 == 0 {
				v.Location, v.Open.Whereabouts, v.Open.NotReturnedAt = asset.LocationUnknown, &unknown, &at
			}
		}
		r.Assets = append(r.Assets, v)
	}
	return r
}

// Every language draws, with Lithuanian and Cyrillic letters, over several
// pages and with no rows at all. REGISTERPDF_OUT=<path> keeps the files to look at.
func TestSIMCards(t *testing.T) {
	for _, lang := range []string{"en", "lt", "ru", "xx"} {
		for _, n := range []int{0, 1, 150} {
			b, err := SIMCards(sample(n), lang)
			if err != nil {
				t.Fatalf("%s, %d rows: %v", lang, n, err)
			}
			if !bytes.HasPrefix(b, []byte("%PDF-")) || len(b) < 1000 {
				t.Fatalf("%s, %d rows: not a PDF (%d bytes)", lang, n, len(b))
			}
			if out := os.Getenv("REGISTERPDF_OUT"); out != "" {
				_ = os.WriteFile(out+"-"+lang+"-"+strconv.Itoa(n)+".pdf", b, 0o600)
			}
		}
	}
}

func TestSIMCardsRefusesEquipment(t *testing.T) {
	if _, err := SIMCards(asset.Report{Filter: asset.ListFilter{Kind: asset.KindEquipment}}, "en"); err == nil {
		t.Error("an equipment register drew as a SIM card list")
	}
}

func TestFilterText(t *testing.T) {
	office, unknown, blocked := asset.LocationOffice, asset.LocationUnknown, asset.StatusBlocked
	for _, c := range []struct {
		f    asset.ListFilter
		want string
	}{
		{asset.ListFilter{}, "none, every SIM card"},
		{asset.ListFilter{Location: &office, Provider: "Bitė"}, "Location: Office, Provider: Bitė"},
		{asset.ListFilter{Held: true, SignedCopyMissing: true}, "Location: With Employee, Documents: Signed Copy Missing"},
		{asset.ListFilter{Location: &unknown, Status: &blocked, Q: "612"}, "Location: Unknown, Status: Blocked, Search: “612”"},
	} {
		if got := filterText(c.f, en); got != c.want {
			t.Errorf("filterText(%+v) = %q, want %q", c.f, got, c.want)
		}
	}
	if got := sortText(asset.ListFilter{Sort: asset.SortGiven, Desc: true}, lt); got != "Išdavimo data, mažėjančiai" {
		t.Errorf("sortText = %q", got)
	}
}

func TestFilename(t *testing.T) {
	if got := Filename(sample(0)); got != "sim-cards-2026-10-28-1435.pdf" {
		t.Errorf("Filename = %q", got)
	}
}
