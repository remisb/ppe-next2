package asset

import (
	"bytes"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/sealbox"
)

// Made-up SIM numbers whose check digits check; none is a real card.
const (
	scanA = "8937099000000000015"
	scanB = "8937099000000000023"
	scanC = "8937099000000000031"
)

func scanFixture(t *testing.T) *fixture {
	t.Helper()
	f := newFixture(t)
	box, err := sealbox.New(bytes.Repeat([]byte{7}, sealbox.KeySize))
	if err != nil {
		t.Fatal(err)
	}
	WithSealer(box)(f.svc)
	return f
}

func batch(cards ...ScannedSIM) AddSIMsParams {
	return AddSIMsParams{Provider: sp("Bitė"), Plan: sp("Business 10 GB"), NonReturnValueCents: ip(5000), Cards: cards}
}

func TestValidSIMNo(t *testing.T) {
	for s, want := range map[string]bool{
		scanA: true, scanA + "F": true, "8937002250201583550": true, "8937002240500235135F": true,
		"8937099000000000016": false, // check digit off by one
		"8937099000000000051": false, // two digits swapped
		"893709900000000001":  false, // 18 digits
		"7937099000000000015": false, // not 89
		"4770192200828":       false, // the carrier's product code
	} {
		if got := validSIMNo(s); got != want {
			t.Errorf("validSIMNo(%s) = %v, want %v", s, got, want)
		}
	}
}

func TestCheckSIMsReportsEveryProblem(t *testing.T) {
	f := scanFixture(t)
	held, err := f.svc.Create(f.ctx, CreateParams{Kind: KindSIM, Params: Params{InventoryNo: "SIM-000900", SimNo: sp(scanC + "F"), Provider: sp("Bitė")}}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	ps, err := f.svc.CheckSIMs(f.ctx, batch(
		ScannedSIM{SimNo: scanA, PIN: "0306", PUK: "12345678"}, // fine
		ScannedSIM{SimNo: "8937099000000000016"},               // check digit
		ScannedSIM{SimNo: "8937 0990 0000 0000 015"},           // same card as 0, with spaces
		ScannedSIM{SimNo: scanC},                               // in the register, there with its F
		ScannedSIM{SimNo: scanB, PIN: "0306"},                  // PIN without PUK
		ScannedSIM{SimNo: "12345", PIN: "03", PUK: "1234"},     // not a SIM No., short codes
	))
	if err != nil {
		t.Fatal(err)
	}
	type got struct {
		i     int
		field string
		code  ProblemCode
	}
	var list []got
	for _, p := range ps {
		list = append(list, got{p.Index, p.Field, p.Code})
		switch p.Code {
		case ProblemDuplicate:
			if p.Other == nil || *p.Other != 0 {
				t.Errorf("duplicate names %v, want card 0", p.Other)
			}
		case ProblemRegistered:
			if p.ExistingID == nil || *p.ExistingID != held.ID {
				t.Errorf("registered names %v, want %s", p.ExistingID, held.ID)
			}
		}
	}
	want := []got{
		{1, "sim_no", ProblemCheckDigit}, {2, "sim_no", ProblemDuplicate}, {4, "puk", ProblemCodesIncomplete},
		{5, "sim_no", ProblemNotSIMNo}, {5, "pin", ProblemPIN}, {5, "puk", ProblemPUK}, {3, "sim_no", ProblemRegistered},
	}
	if !slices.Equal(list, want) {
		t.Errorf("problems = %v, want %v", list, want)
	}
	if ps, err := f.svc.CheckSIMs(f.ctx, batch(ScannedSIM{SimNo: scanA})); err != nil || len(ps) != 0 || ps == nil {
		t.Errorf("a clean batch = %v, %v; want []", ps, err)
	}
	for name, p := range map[string]AddSIMsParams{
		"no cards":       {Provider: sp("Bitė")},
		"no provider":    {Cards: []ScannedSIM{{SimNo: scanA}}},
		"too many cards": {Provider: sp("Bitė"), Cards: make([]ScannedSIM, MaxScannedSIMs+1)},
		"a later date":   {Provider: sp("Bitė"), ReceivedDate: sp("2026-10-10"), Cards: []ScannedSIM{{SimNo: scanA}}},
	} {
		if _, err := f.svc.CheckSIMs(f.ctx, p); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v, want ErrInvalid", name, err)
		}
	}
}

func TestAddSIMs(t *testing.T) {
	f := scanFixture(t)
	added, err := f.svc.AddSIMs(f.ctx, batch(
		ScannedSIM{SimNo: scanA, PIN: "0306", PUK: "93691381"},
		ScannedSIM{SimNo: " " + scanB + "f "},
	), testActor)
	if err != nil {
		t.Fatal(err)
	}
	if len(added) != 2 || added[0].InventoryNo != "SIM-000001" || added[1].InventoryNo != "SIM-000002" || added[1].SimNo != scanB+"F" {
		t.Fatalf("added = %+v", added)
	}
	a := f.repo.assets[added[0].ID]
	if *a.ConnectionStatus != StatusNotActivated || *a.Provider != "Bitė" || *a.Plan != "Business 10 GB" || *a.NonReturnValueCents != 5000 ||
		*a.ReceivedDate != "2026-10-09" || f.svc.view(Record{Asset: a}).Location != LocationOffice {
		t.Errorf("first card = %+v", a)
	}
	if _, ok := f.repo.codes[added[1].ID]; ok {
		t.Error("a card without codes has codes")
	}
	// The codes are sealed for their card, and nothing the API answers or
	// records holds them.
	sealed := f.repo.codes[added[0].ID]
	if bytes.Contains(sealed.Sealed, []byte("0306")) || bytes.Contains(sealed.Sealed, []byte("93691381")) || sealed.KeyID != sealKeyID {
		t.Errorf("sealed = %+v", sealed)
	}
	v, _ := f.svc.Get(f.ctx, added[0].ID)
	body, _ := json.Marshal(v)
	events, _ := json.Marshal(f.repo.events)
	for _, b := range [][]byte{body, events} {
		if bytes.Contains(b, []byte("0306")) || bytes.Contains(b, []byte("93691381")) {
			t.Errorf("the codes leak: %s", b)
		}
	}
	if !bytes.Contains(events, []byte(`"sim_codes":"set"`)) {
		t.Errorf("asset.registered does not say the card has codes: %s", events)
	}

	// One bad card refuses the batch, by its index; one in the register names it.
	before := len(f.repo.assets)
	_, err = f.svc.AddSIMs(f.ctx, batch(ScannedSIM{SimNo: scanC}, ScannedSIM{SimNo: scanC[:18] + "2"}), testActor)
	var row *ImportRowError
	if !errors.As(err, &row) || row.Index != 1 || !errors.Is(err, ErrInvalid) || strings.Contains(err.Error(), scanC[:18]) {
		t.Errorf("a bad check digit = %v", err)
	}
	_, err = f.svc.AddSIMs(f.ctx, batch(ScannedSIM{SimNo: scanC}, ScannedSIM{SimNo: scanA + "F"}), testActor)
	var dup *DuplicateError
	if !errors.As(err, &row) || row.Index != 1 || !errors.As(err, &dup) || dup.Existing != added[0].ID {
		t.Errorf("a card in the register = %v", err)
	}
	_, err = f.svc.AddSIMs(f.ctx, batch(ScannedSIM{SimNo: scanC, PIN: "1234", PUK: "87654321"}, ScannedSIM{SimNo: scanC + "F"}), testActor)
	if !errors.As(err, &row) || row.Index != 1 || !errors.Is(err, ErrSIMNoTaken) {
		t.Errorf("a card twice in the batch = %v", err)
	}
	_, err = f.svc.AddSIMs(f.ctx, batch(ScannedSIM{SimNo: scanC, PIN: "12", PUK: "87654321"}), testActor)
	if !errors.As(err, &row) || row.Index != 0 || strings.Contains(err.Error(), "87654321") {
		t.Errorf("a short PIN = %v", err)
	}
	if len(f.repo.assets) != before {
		t.Errorf("refused batches wrote %d cards", len(f.repo.assets)-before)
	}

	plain := newFixture(t)
	if _, err := plain.svc.AddSIMs(plain.ctx, batch(ScannedSIM{SimNo: scanA, PIN: "1234", PUK: "87654321"}), testActor); !errors.Is(err, ErrSIMCodesUnavailable) {
		t.Errorf("codes without a sealer = %v", err)
	}
	if _, err := plain.svc.AddSIMs(plain.ctx, batch(ScannedSIM{SimNo: scanA}), testActor); err != nil {
		t.Errorf("a card without codes needs no sealer: %v", err)
	}
	if _, err := f.svc.AddSIMs(f.ctx, batch(ScannedSIM{SimNo: scanC}), uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("no actor = %v", err)
	}
}

func TestShowSetClearSIMCodes(t *testing.T) {
	f := scanFixture(t)
	added, err := f.svc.AddSIMs(f.ctx, batch(ScannedSIM{SimNo: scanA, PIN: "0306", PUK: "93691381"}, ScannedSIM{SimNo: scanB}), testActor)
	if err != nil {
		t.Fatal(err)
	}
	withCodes, without := added[0].ID, added[1].ID
	events := len(f.repo.events)
	c, err := f.svc.ShowSIMCodes(f.ctx, withCodes, testActor)
	if err != nil || c != (SIMCodes{PIN: "0306", PUK: "93691381"}) {
		t.Fatalf("Show = %+v, %v", c, err)
	}
	if len(f.repo.events) != events+1 || f.repo.events[events].Event != EventSIMCodesShown {
		t.Errorf("Show recorded %v", f.repo.events[events:])
	}
	if _, err := f.svc.ShowSIMCodes(f.ctx, without, testActor); !errors.Is(err, ErrNoSIMCodes) || len(f.repo.events) != events+1 {
		t.Errorf("Show without codes = %v, events %d", err, len(f.repo.events)-events)
	}

	// Codes copied to another card do not open there.
	f.repo.codes[without] = SealedCodes{AssetID: without, Sealed: f.repo.codes[withCodes].Sealed, KeyID: sealKeyID}
	if _, err := f.svc.ShowSIMCodes(f.ctx, without, testActor); err == nil || errors.Is(err, ErrNoSIMCodes) {
		t.Errorf("moved codes opened: %v", err)
	}
	delete(f.repo.codes, without)

	if err := f.svc.SetSIMCodes(f.ctx, without, SIMCodes{PIN: " 8134 ", PUK: "90651799"}, testActor); err != nil {
		t.Fatal(err)
	}
	if c, _ := f.svc.ShowSIMCodes(f.ctx, without, testActor); c != (SIMCodes{PIN: "8134", PUK: "90651799"}) {
		t.Errorf("after Set = %+v", c)
	}
	for _, bad := range []SIMCodes{{PIN: "81", PUK: "90651799"}, {PIN: "8134", PUK: "9065"}, {PIN: "81a4", PUK: "90651799"}} {
		if err := f.svc.SetSIMCodes(f.ctx, without, bad, testActor); !errors.Is(err, ErrInvalid) || strings.Contains(err.Error(), bad.PIN) && len(bad.PIN) > 2 {
			t.Errorf("Set %+v = %v", bad, err)
		}
	}
	if err := f.svc.ClearSIMCodes(f.ctx, without, testActor); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.ClearSIMCodes(f.ctx, without, testActor); !errors.Is(err, ErrNoSIMCodes) {
		t.Errorf("Clear twice = %v", err)
	}
	evs, _ := json.Marshal(f.repo.events)
	if bytes.Contains(evs, []byte("8134")) || bytes.Contains(evs, []byte("90651799")) {
		t.Errorf("events hold the codes: %s", evs)
	}

	laptop, err := f.svc.Create(f.ctx, CreateParams{Kind: KindEquipment, Params: Params{InventoryNo: "PC-000001", Name: sp("Laptop"), Category: ptr(CategoryComputer)}}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.SetSIMCodes(f.ctx, laptop.ID, SIMCodes{PIN: "1234", PUK: "12345678"}, testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("codes on equipment = %v", err)
	}
	if _, err := f.svc.ShowSIMCodes(f.ctx, uuid.New(), testActor); !errors.Is(err, ErrNotFound) {
		t.Errorf("Show of a missing card = %v", err)
	}
	if _, err := newFixture(t).svc.ShowSIMCodes(f.ctx, withCodes, testActor); !errors.Is(err, ErrSIMCodesUnavailable) {
		t.Errorf("Show without a sealer = %v", err)
	}
}
