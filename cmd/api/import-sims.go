package main

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
	"slices"
	"strings"
	"text/tabwriter"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"

	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/user"
)

// importComment is on each imported assignment: the card was held before the
// app, so the assignment has no form.
const importComment = "Imported from the SIM card list: held before the app, no assignment form."

// simColumns are the SIM card list's columns, in any order.
var simColumns = []string{"sim_no", "phone_no", "provider", "employee_name", "connection_status"}

// simStatuses read the list's connection status. Available is a working card
// that nobody holds.
var simStatuses = map[string]asset.Status{
	"active": asset.StatusActive, "available": asset.StatusActive, "blocked": asset.StatusBlocked,
	"not activated": asset.StatusNotActivated, "not_activated": asset.StatusNotActivated,
}

// simRow is one card of the list, with the line it is on and its holder.
type simRow struct {
	Line   int
	SIM    asset.ImportSIM
	Holder string // the employee's name in the app
}

// importSIMs reads the SIM card list at the -import-sims path ("-" for
// standard input, as make prod-import-sims sends it) and imports it as the
// API_SEED_USER_EMAIL user. Without commit it only checks it
// and prints what it would write. Every problem in the file is reported
// before anything is written; then the cards are written all or none.
func importSIMs(ctx context.Context, svc services, cfg config, out io.Writer) error {
	actor, err := svc.users.ByEmail(ctx, cfg.SeedUserEmail)
	if errors.Is(err, user.ErrNotFound) {
		return fmt.Errorf("API_SEED_USER_EMAIL %s is not a user: the import is recorded as that user", cfg.SeedUserEmail)
	}
	if err != nil {
		return err
	}
	var data []byte
	name := cfg.ImportSIMs
	if name == "-" {
		name = "the SIM card list"
		data, err = io.ReadAll(os.Stdin)
	} else {
		data, err = os.ReadFile(cfg.ImportSIMs)
	}
	if err != nil {
		return err
	}
	employees, err := svc.employees.List(ctx)
	if err != nil {
		return err
	}
	rows, problems := parseSIMList(data, employees)
	if len(problems) > 0 {
		for _, p := range problems {
			fmt.Fprintln(out, p)
		}
		return fmt.Errorf("%s: %d problems, nothing imported", name, len(problems))
	}
	prefs, err := svc.settings.Get(ctx)
	if err != nil {
		return err
	}
	for _, r := range rows {
		if p := *r.SIM.Provider; len(prefs.SIMProviders) > 0 && !slices.Contains(prefs.ProviderNames(), p) {
			fmt.Fprintf(out, "line %d: note: provider %q is not among Settings' SIM providers %v\n", r.Line, p, prefs.ProviderNames())
		}
	}

	p := asset.ImportParams{Comment: importComment, Commit: cfg.ImportCommit}
	for _, r := range rows {
		p.SIMs = append(p.SIMs, r.SIM)
	}
	res, err := svc.assets.ImportSIMs(ctx, p, actor.ID)
	if row := (*asset.ImportRowError)(nil); errors.As(err, &row) {
		return fmt.Errorf("%s, line %d (SIM %s): %w; nothing imported", name, rows[row.Index].Line, *rows[row.Index].SIM.SimNo, row.Err)
	}
	if err != nil {
		return err
	}

	tw := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "LINE\tNUMBER\tSIM NO.\tPHONE NO.\tPROVIDER\tSTATUS\tHELD BY")
	held := 0
	for i, s := range res.SIMs {
		r := rows[i]
		phone := "-"
		if r.SIM.PhoneNo != nil {
			phone = *r.SIM.PhoneNo
		}
		holder := "-"
		if s.Holder != "" {
			holder, held = s.Holder, held+1
		}
		fmt.Fprintf(tw, "%d\t%s\t%s\t%s\t%s\t%s\t%s\n", r.Line, s.InventoryNo, s.SimNo, phone, *r.SIM.Provider, s.Status, holder)
	}
	if err := tw.Flush(); err != nil {
		return err
	}
	if res.Committed {
		fmt.Fprintf(out, "Imported %d SIM cards, %d of them held, as %s.\n", len(res.SIMs), held, actor.Email)
	} else {
		fmt.Fprintf(out, "Checked %d SIM cards, %d of them held: nothing was written. Run again with -commit to import them.\n", len(res.SIMs), held)
	}
	return nil
}

// parseSIMList reads the SIM card list (UTF-8, a header row, commas or
// semicolons) and finds each holder among employees by name, in either
// order, case and accents aside. It returns every problem it finds, with
// its line.
func parseSIMList(data []byte, employees []employee.Employee) ([]simRow, []error) {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")) // Excel's byte order mark
	r := csv.NewReader(bytes.NewReader(data))
	if header, _, _ := bytes.Cut(data, []byte("\n")); bytes.Count(header, []byte(";")) > bytes.Count(header, []byte(",")) {
		r.Comma = ';'
	}
	r.FieldsPerRecord = -1 // checked here, with the line
	records, err := r.ReadAll()
	if err != nil {
		return nil, []error{err}
	}
	if len(records) == 0 {
		return nil, []error{errors.New("the file is empty")}
	}
	col := map[string]int{}
	for i, name := range records[0] {
		col[strings.ToLower(strings.TrimSpace(name))] = i
	}
	var problems []error
	for _, want := range simColumns {
		if _, ok := col[want]; !ok {
			problems = append(problems, fmt.Errorf("line 1: no %s column (the columns are %s)", want, strings.Join(simColumns, ", ")))
		}
	}
	if len(col) != len(simColumns) && len(problems) == 0 {
		problems = append(problems, fmt.Errorf("line 1: the columns must be exactly %s", strings.Join(simColumns, ", ")))
	}
	if len(problems) > 0 {
		return nil, problems
	}

	byName := map[string][]employee.Employee{}
	for _, e := range employees {
		k := nameKey(e.FirstName + " " + e.LastName)
		byName[k] = append(byName[k], e)
	}
	var rows []simRow
	for i, rec := range records[1:] {
		line := i + 2
		if strings.TrimSpace(strings.Join(rec, "")) == "" {
			continue
		}
		if len(rec) != len(simColumns) {
			problems = append(problems, fmt.Errorf("line %d: %d fields, want %d", line, len(rec), len(simColumns)))
			continue
		}
		field := func(name string) string { return strings.TrimSpace(rec[col[name]]) }
		row := simRow{Line: line}
		simNo, phone, provider, name, status := field("sim_no"), field("phone_no"), field("provider"), field("employee_name"), field("connection_status")
		row.SIM.SimNo, row.SIM.Provider = &simNo, &provider
		if phone != "" {
			phone = formatPhone(phone)
			row.SIM.PhoneNo = &phone
		}
		st, ok := simStatuses[strings.ToLower(status)]
		switch {
		case simNo == "":
			problems = append(problems, fmt.Errorf("line %d: no sim_no", line))
		case provider == "":
			problems = append(problems, fmt.Errorf("line %d: no provider", line))
		case !ok:
			problems = append(problems, fmt.Errorf("line %d: connection_status %q is not Active, Available, Blocked or Not Activated", line, status))
		case strings.EqualFold(status, "available") && name != "":
			problems = append(problems, fmt.Errorf("line %d: Available, but held by %q", line, name))
		}
		row.SIM.Status = st
		if name != "" {
			switch found := byName[nameKey(name)]; len(found) {
			case 0:
				problems = append(problems, fmt.Errorf("line %d: no employee is named %q", line, name))
			case 1:
				row.SIM.HolderID, row.Holder = ptr(found[0].ID), found[0].FirstName+" "+found[0].LastName
			default:
				problems = append(problems, fmt.Errorf("line %d: %d employees are named %q (%s)", line, len(found), name, employeeCodes(found)))
			}
		}
		rows = append(rows, row)
	}
	if len(rows) == 0 && len(problems) == 0 {
		problems = append(problems, errors.New("the file has no SIM cards"))
	}
	return rows, problems
}

// nameKey is a name's words in order, lower case, without accents: "Gild
// Yuriy" and "Yuriy Gild" are one key, as are "Roškaitė" and "Roskaite".
func nameKey(name string) string {
	folded, _, err := transform.String(transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC), name)
	if err != nil {
		folded = name
	}
	words := strings.Fields(strings.ToLower(folded))
	slices.Sort(words)
	return strings.Join(words, " ")
}

func employeeCodes(es []employee.Employee) string {
	var codes []string
	for _, e := range es {
		if e.Code != nil {
			codes = append(codes, "code "+*e.Code)
		} else {
			codes = append(codes, "no code, id "+e.ID.String())
		}
	}
	return strings.Join(codes, "; ")
}

var ltMobile = regexp.MustCompile(`^\+?370(\d{3})(\d{5})$`)

// formatPhone writes a Lithuanian number as the app does, "+370 603 27629";
// any other number is kept as written.
func formatPhone(s string) string {
	if m := ltMobile.FindStringSubmatch(strings.ReplaceAll(s, " ", "")); m != nil {
		return "+370 " + m[1] + " " + m[2]
	}
	return s
}
