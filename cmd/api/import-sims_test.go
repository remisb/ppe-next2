package main

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/employee"
)

func emp(first, last string, code *string) employee.Employee {
	return employee.Employee{ID: uuid.New(), FirstName: first, LastName: last, Code: code}
}

// The training file's structure: names in either order, Available with and
// without a phone number, Blocked held.
const simList = "\xef\xbb\xbfsim_no,phone_no,provider,employee_name,connection_status\n" +
	"1237002240500235267F,37060327629,Bitė,Gild Yuriy,Active\n" +
	"1237002231100060288F,37060666613,Bitė,Karina Roskaite,Active\n" +
	"1237002250200908444F,37069949054,Bitė,Islam Nazmul,Blocked\n" +
	"1237002250201583923,37069065909,Bitė,,Available\n" +
	"1237002250201583196,,Bitė,,Available\n" +
	",,,,\n"

func TestParseSIMList(t *testing.T) {
	yuriy, karina, nazmul := emp("Yuriy", "Gild", nil), emp("Karina", "Roškaitė", nil), emp("Nazmul", "Islam", nil)
	rows, problems := parseSIMList([]byte(simList), []employee.Employee{yuriy, karina, nazmul, emp("Jonas", "Petraitis", nil)})
	if len(problems) > 0 {
		t.Fatalf("problems: %v", problems)
	}
	if len(rows) != 5 {
		t.Fatalf("%d rows, want 5 (the blank one skipped)", len(rows))
	}
	type want struct {
		line   int
		phone  string
		status asset.Status
		holder *uuid.UUID
	}
	for i, w := range []want{
		{2, "+370 603 27629", asset.StatusActive, &yuriy.ID},
		{3, "+370 606 66613", asset.StatusActive, &karina.ID}, // accents aside
		{4, "+370 699 49054", asset.StatusBlocked, &nazmul.ID},
		{5, "+370 690 65909", asset.StatusActive, nil},
		{6, "", asset.StatusActive, nil},
	} {
		r := rows[i]
		phone := ""
		if r.SIM.PhoneNo != nil {
			phone = *r.SIM.PhoneNo
		}
		if r.Line != w.line || phone != w.phone || r.SIM.Status != w.status || *r.SIM.Provider != "Bitė" {
			t.Errorf("row %d = line %d, %q, %s, %s", i, r.Line, phone, r.SIM.Status, *r.SIM.Provider)
		}
		if (r.SIM.HolderID == nil) != (w.holder == nil) || (w.holder != nil && *r.SIM.HolderID != *w.holder) {
			t.Errorf("row %d holder = %v, want %v", i, r.SIM.HolderID, w.holder)
		}
	}
	if rows[0].Holder != "Yuriy Gild" {
		t.Errorf("holder name = %q", rows[0].Holder)
	}
}

func TestParseSIMListSemicolons(t *testing.T) {
	rows, problems := parseSIMList([]byte("sim_no;phone_no;provider;employee_name;connection_status\r\n8937001;+370 612 40118;Telia;;Active\r\n"), nil)
	if len(problems) > 0 || len(rows) != 1 || *rows[0].SIM.SimNo != "8937001" || *rows[0].SIM.PhoneNo != "+370 612 40118" {
		t.Fatalf("rows %+v, problems %v", rows, problems)
	}
}

func TestParseSIMListProblems(t *testing.T) {
	twin1, twin2 := emp("Jonas", "Petraitis", ptr("0142")), emp("Jonas", "Petraitis", ptr("0143"))
	data := "sim_no,phone_no,provider,employee_name,connection_status\n" +
		"8937001,,Bitė,Nobody Here,Active\n" +
		"8937002,,Bitė,Petraitis Jonas,Active\n" +
		"8937003,,Bitė,,Lost\n" +
		"8937004,,Bitė,Jonas Petraitis,Available\n" +
		",,Bitė,,Active\n" +
		"8937006,,Bitė,Active\n"
	_, problems := parseSIMList([]byte(data), []employee.Employee{twin1, twin2})
	var got []string
	for _, p := range problems {
		got = append(got, p.Error())
	}
	for _, want := range []string{
		`line 2: no employee is named "Nobody Here"`,
		`line 3: 2 employees are named "Petraitis Jonas" (code 0142; code 0143)`,
		`line 4: connection_status "Lost"`,
		`line 5: Available, but held by "Jonas Petraitis"`,
		`line 6: no sim_no`,
		`line 7: 4 fields, want 5`,
	} {
		if !strings.Contains(strings.Join(got, "\n"), want) {
			t.Errorf("no problem %q in\n%s", want, strings.Join(got, "\n"))
		}
	}
	// Line 5's name is also ambiguous.
	if len(problems) != 7 {
		t.Errorf("%d problems, want 7", len(problems))
	}

	if _, problems := parseSIMList([]byte("sim_no,phone,provider,employee_name,connection_status\n1,,Bitė,,Active\n"), nil); len(problems) != 1 ||
		!strings.Contains(problems[0].Error(), "no phone_no column") {
		t.Errorf("wrong header: %v", problems)
	}
	if _, problems := parseSIMList([]byte("sim_no,phone_no,provider,employee_name,connection_status,plan\n"), nil); len(problems) != 1 {
		t.Errorf("extra column: %v", problems)
	}
	if _, problems := parseSIMList([]byte("sim_no,phone_no,provider,employee_name,connection_status\n"), nil); len(problems) != 1 {
		t.Errorf("no cards: %v", problems)
	}
}

func TestFormatPhone(t *testing.T) {
	for in, want := range map[string]string{
		"37060327629": "+370 603 27629", "+37060327629": "+370 603 27629", "+370 603 27629": "+370 603 27629",
		"+48 600 000 000": "+48 600 000 000", "860327629": "860327629",
	} {
		if got := formatPhone(in); got != want {
			t.Errorf("formatPhone(%q) = %q, want %q", in, got, want)
		}
	}
}
