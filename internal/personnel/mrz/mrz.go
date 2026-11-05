package mrz

import (
	"regexp"
	"strings"
)

// Format is an MRZ's shape.
type Format string

const (
	TD1 Format = "TD1" // ID cards: 3 lines of 30
	TD2 Format = "TD2" // older ID cards, some visas: 2 lines of 36
	TD3 Format = "TD3" // passports: 2 lines of 44
)

// formats are each format's lines and their length, in @ppe/mrz's order.
var formats = []struct {
	format       Format
	lines, width int
}{{TD1, 3, 30}, {TD2, 2, 36}, {TD3, 2, 44}}

// FormatOf is the format these lines' shape is, and "" for none.
func FormatOf(lines []string) Format {
	for _, f := range formats {
		if len(lines) != f.lines {
			continue
		}
		ok := true
		for _, l := range lines {
			if len(l) != f.width {
				ok = false
			}
		}
		if ok {
			return f.format
		}
	}
	return ""
}

// The fields' names, as @ppe/mrz names them (the review underlines them, and
// problems and notes name them).
const (
	fDocumentCode        = "documentCode"
	fIssuingState        = "issuingState"
	fDocumentNumber      = "documentNumber"
	fDocumentNumberCheck = "documentNumberCheck"
	fOptionalData1       = "optionalData1"
	fBirthDate           = "birthDate"
	fBirthDateCheck      = "birthDateCheck"
	fSex                 = "sex"
	fExpiryDate          = "expiryDate"
	fExpiryDateCheck     = "expiryDateCheck"
	fNationality         = "nationality"
	fOptionalData2       = "optionalData2"
	fPersonalNumber      = "personalNumber"
	fPersonalNumberCheck = "personalNumberCheck"
	fCompositeCheck      = "compositeCheck"
	fNames               = "names"
	// The composite check digit's name among the checks.
	checkComposite = "composite"
)

// Problem and note codes: a problem stops Save, a note is shown.
const (
	ProblemCheckDigit                  = "check_digit"
	ProblemAmbiguousCorrection         = "ambiguous_correction"
	ProblemInvalidCharacter            = "invalid_character"
	ProblemInvalidDate                 = "invalid_date"
	ProblemInvalidSex                  = "invalid_sex"
	ProblemUnknownState                = "unknown_state"
	ProblemNoSurname                   = "no_surname"
	ProblemNamesUnreadable             = "names_unreadable"
	ProblemExpiryBeforeBirth           = "expiry_before_birth"
	ProblemBirthInFuture               = "birth_in_future"
	ProblemUnsupportedDocument         = "unsupported_document"
	ProblemPersonalCodeChecksum        = "personal_code_checksum"
	ProblemPersonalCodeBirthDate       = "personal_code_birth_date"
	ProblemPersonalCodeSex             = "personal_code_sex"
	NoteExpired                        = "expired"
	NoteSpecimen                       = "specimen"
	NoteIncompleteDate                 = "incomplete_date"
	NoteCorrected                      = "corrected"
	CorrectionByLayout                 = "layout"
	CorrectionByLookalike              = "lookalike"
	classDigit, classAlpha, classAlnum = 'd', 'a', 'n'
)

// Issue is a problem or a note: a code and the field it is about, never a value.
type Issue struct {
	Code  string `json:"code"`
	Field string `json:"field,omitempty"`
}

// Correction is a field the parser changed, and what decided it: layout (the
// character could not be there, so its look-alike is the only reading) or
// lookalike (FR-5's search chose the one combination of look-alikes that makes
// a number's check digit pass; that reading needs a second, agreeing read).
type Correction struct {
	Field string `json:"field"`
	By    string `json:"by"`
}

// Span is where a field lies: line and columns, end exclusive.
type Span struct {
	Field string `json:"field"`
	Line  int    `json:"line"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

// PersonalCode is the Lithuanian personal code a Lithuanian document carries.
type PersonalCode struct {
	Code string `json:"code"`
	LtPersonalCode
}

// Mrz is what Parse read. Its JSON is @ppe/mrz's Mrz, field for field.
type Mrz struct {
	Format Format `json:"format"`
	// Lines are the lines as read, with the corrections applied.
	Lines          []string `json:"lines"`
	DocumentCode   string   `json:"documentCode"`
	IssuingState   string   `json:"issuingState"`
	DocumentNumber string   `json:"documentNumber"`
	Nationality    string   `json:"nationality"`
	// BirthDate and ExpiryDate are ISO; nil when the MRZ's is not a whole date.
	BirthDate  *string `json:"birthDate"`
	ExpiryDate *string `json:"expiryDate"`
	// Sex is M, F or X; nil when it is none of them.
	Sex *string `json:"sex"`
	// Surname and GivenNames are as in the MRZ: capitals, fillers as spaces.
	Surname    string `json:"surname"`
	GivenNames string `json:"givenNames"`
	// NameField is the name field itself, fillers kept (for NameMatch).
	NameField string `json:"nameField"`
	// OptionalData, fillers removed: TD1 two fields, TD2 one, TD3 the personal number.
	OptionalData []string        `json:"optionalData"`
	PersonalCode *PersonalCode   `json:"personalCode,omitempty"`
	Checks       map[string]bool `json:"checks"`
	Corrections  []Correction    `json:"corrections"`
	Problems     []Issue         `json:"problems"`
	Notes        []Issue         `json:"notes"`
	Spans        []Span          `json:"spans"`
	// Valid is no problems: every check digit passes and every cross-check agrees.
	Valid bool `json:"valid"`
	// NeedsSecondRead is that the document number's reading rests on its one
	// check digit alone (a look-alike search chose it): accept it only when a
	// second read gives the same lines.
	NeedsSecondRead bool `json:"needsSecondRead"`
}

// Options are what Parse needs besides the lines.
type Options struct {
	// Today is ISO (YYYY-MM-DD): the century rules and "expired" depend on it.
	Today string
	// NoNumberCorrections turns FR-5's look-alike search in number fields off.
	NoNumberCorrections bool
}

type fieldDef struct {
	field            string
	line, start, end int
	class            byte
}

var layouts = map[Format][]fieldDef{
	TD1: {
		{fDocumentCode, 0, 0, 2, classAlpha},
		{fIssuingState, 0, 2, 5, classAlpha},
		{fDocumentNumber, 0, 5, 14, classAlnum},
		{fDocumentNumberCheck, 0, 14, 15, classDigit},
		{fOptionalData1, 0, 15, 30, classAlnum},
		{fBirthDate, 1, 0, 6, classDigit},
		{fBirthDateCheck, 1, 6, 7, classDigit},
		{fSex, 1, 7, 8, classAlpha},
		{fExpiryDate, 1, 8, 14, classDigit},
		{fExpiryDateCheck, 1, 14, 15, classDigit},
		{fNationality, 1, 15, 18, classAlpha},
		{fOptionalData2, 1, 18, 29, classAlnum},
		{fCompositeCheck, 1, 29, 30, classDigit},
		{fNames, 2, 0, 30, classAlpha},
	},
	TD2: {
		{fDocumentCode, 0, 0, 2, classAlpha},
		{fIssuingState, 0, 2, 5, classAlpha},
		{fNames, 0, 5, 36, classAlpha},
		{fDocumentNumber, 1, 0, 9, classAlnum},
		{fDocumentNumberCheck, 1, 9, 10, classDigit},
		{fNationality, 1, 10, 13, classAlpha},
		{fBirthDate, 1, 13, 19, classDigit},
		{fBirthDateCheck, 1, 19, 20, classDigit},
		{fSex, 1, 20, 21, classAlpha},
		{fExpiryDate, 1, 21, 27, classDigit},
		{fExpiryDateCheck, 1, 27, 28, classDigit},
		{fOptionalData2, 1, 28, 35, classAlnum},
		{fCompositeCheck, 1, 35, 36, classDigit},
	},
	TD3: {
		{fDocumentCode, 0, 0, 2, classAlpha},
		{fIssuingState, 0, 2, 5, classAlpha},
		{fNames, 0, 5, 44, classAlpha},
		{fDocumentNumber, 1, 0, 9, classAlnum},
		{fDocumentNumberCheck, 1, 9, 10, classDigit},
		{fNationality, 1, 10, 13, classAlpha},
		{fBirthDate, 1, 13, 19, classDigit},
		{fBirthDateCheck, 1, 19, 20, classDigit},
		{fSex, 1, 20, 21, classAlpha},
		{fExpiryDate, 1, 21, 27, classDigit},
		{fExpiryDateCheck, 1, 27, 28, classDigit},
		{fPersonalNumber, 1, 28, 42, classAlnum},
		{fPersonalNumberCheck, 1, 42, 43, classDigit},
		{fCompositeCheck, 1, 43, 44, classDigit},
	},
}

type part struct{ line, start, end int }

// composites are the parts of the lines the composite check digit covers.
var composites = map[Format][]part{
	TD1: {{0, 5, 30}, {1, 0, 7}, {1, 8, 15}, {1, 18, 29}},
	TD2: {{1, 0, 10}, {1, 13, 20}, {1, 21, 35}},
	TD3: {{1, 0, 10}, {1, 13, 20}, {1, 21, 43}},
}

// FR-5's look-alikes: what a letter in a digit's place stands for, and back.
// K and < are left out: no check digit tells them apart.
var (
	toDigit  = map[byte]byte{'O': '0', 'I': '1', 'B': '8', 'S': '5', 'Z': '2'}
	toLetter = map[byte]byte{'0': 'O', '1': 'I', '8': 'B', '5': 'S', '2': 'Z'}
	swap     = func() map[byte]byte {
		m := map[byte]byte{}
		for k, v := range toDigit {
			m[k] = v
		}
		for k, v := range toLetter {
			m[k] = v
		}
		return m
	}()
)

const (
	// MaxTriesPerField is the most combinations of look-alikes tried in one field (FR-5).
	MaxTriesPerField = 64
	// maxCompositeTries is the most combinations of the failing fields' candidates the composite is asked about.
	maxCompositeTries = 256
)

type pos struct{ line, col int }

// checked is a field a check digit protects: where its characters are and where its digit is.
type checked struct {
	name, field   string
	value         []pos
	check         pos
	class         byte
	fillerAllowed bool // the personal number's digit may be < when the field is all fillers
}

var (
	mrzChars       = regexp.MustCompile(`^[A-Z0-9<]*$`)
	digitsOrFiller = regexp.MustCompile(`^[0-9<]*$`)
	lettersOrFill  = regexp.MustCompile(`^[A-Z<]*$`)
	partialDate    = regexp.MustCompile(`^\d{2}[\d<]{4}$`)
	namesSplit     = regexp.MustCompile(`[A-Z]<{3,}[A-Z]`)
	spaces         = regexp.MustCompile(`\s+`)
	numberTail     = regexp.MustCompile(`<[<K]*$`)
)

// Parse parses lines of the right shape (FormatOf), applying FR-5's
// corrections. It is nil when the shape is no format's or a line holds a
// character an MRZ never does.
func Parse(input []string, opts Options) *Mrz {
	format := FormatOf(input)
	if format == "" {
		return nil
	}
	for _, l := range input {
		if !mrzChars.MatchString(l) {
			return nil
		}
	}
	grid := make([][]byte, len(input))
	for i, l := range input {
		grid[i] = []byte(l)
	}
	at := func(p pos) byte { return grid[p.line][p.col] }
	set := func(p pos, c byte) { grid[p.line][p.col] = c }
	text := func(ps []pos) string {
		b := make([]byte, len(ps))
		for i, p := range ps {
			b[i] = at(p)
		}
		return string(b)
	}
	layout := layouts[format]
	def := func(name string) (fieldDef, bool) {
		for _, d := range layout {
			if d.field == name {
				return d, true
			}
		}
		return fieldDef{}, false
	}
	must := func(name string) fieldDef { d, _ := def(name); return d }
	positions := func(line, start, end int) []pos {
		ps := make([]pos, 0, end-start)
		for c := start; c < end; c++ {
			ps = append(ps, pos{line, c})
		}
		return ps
	}
	defPositions := func(d fieldDef) []pos { return positions(d.line, d.start, d.end) }

	// 1. What the layout alone decides: a letter where only a digit may be, a
	// digit where only a letter may be, and K among the fillers.
	for _, d := range layout {
		for _, p := range defPositions(d) {
			c := at(p)
			if d.class == classDigit {
				if r, ok := toDigit[c]; ok {
					set(p, r)
				}
				if c == 'K' && strings.HasSuffix(d.field, "Check") {
					set(p, '<')
				}
			}
			if d.class == classAlpha {
				if r, ok := toLetter[c]; ok {
					set(p, r)
				}
			}
		}
	}
	fillerTail(defPositions(must(fNames)), at, set)
	for _, name := range []string{fDocumentNumber, fOptionalData1, fOptionalData2, fPersonalNumber} {
		if d, ok := def(name); ok {
			kAmongFillers(defPositions(d), at, set)
		}
	}

	// 2. The checked fields, with a long document number (over 9 characters)
	// continued in the optional data (TD1 and TD2: its digit's place is <).
	var checks []checked
	spans := make([]Span, len(layout))
	for i, d := range layout {
		spans[i] = Span{d.field, d.line, d.start, d.end}
	}
	findSpan := func(field string) *Span {
		for i := range spans {
			if spans[i].Field == field {
				return &spans[i]
			}
		}
		return nil
	}
	docDef, docCheck := must(fDocumentNumber), must(fDocumentNumberCheck)
	var optDef *fieldDef
	switch format {
	case TD1:
		d := must(fOptionalData1)
		optDef = &d
	case TD2:
		d := must(fOptionalData2)
		optDef = &d
	}
	docValue := defPositions(docDef)
	docCheckPos := pos{docCheck.line, docCheck.start}
	if optDef != nil && at(docCheckPos) == '<' && at(pos{optDef.line, optDef.start}) != '<' {
		opt := defPositions(*optDef)
		rest := opt
		for i, p := range opt {
			if at(p) == '<' {
				rest = opt[:i]
				break
			}
		}
		if len(rest) >= 2 {
			docValue = append(append([]pos{}, docValue...), rest[:len(rest)-1]...)
			docCheckPos = rest[len(rest)-1]
			// The spans say where the number and its digit really are: the first
			// digit's place is a filler that belongs to the number.
			at0 := optDef.start
			findSpan(fDocumentNumberCheck).Field = fDocumentNumber
			findSpan(optDef.field).Start = at0 + len(rest)
			spans = append(spans,
				Span{fDocumentNumber, optDef.line, at0, at0 + len(rest) - 1},
				Span{fDocumentNumberCheck, optDef.line, at0 + len(rest) - 1, at0 + len(rest)})
		}
	}
	checks = append(checks, checked{name: fDocumentNumber, field: fDocumentNumber, value: docValue, check: docCheckPos, class: classAlnum})
	bd := must(fBirthDate)
	checks = append(checks, checked{name: fBirthDate, field: fBirthDate, value: defPositions(bd), check: pos{bd.line, bd.end}, class: classDigit})
	ed := must(fExpiryDate)
	checks = append(checks, checked{name: fExpiryDate, field: fExpiryDate, value: defPositions(ed), check: pos{ed.line, ed.end}, class: classDigit})
	if format == TD3 {
		pn := must(fPersonalNumber)
		checks = append(checks, checked{name: fPersonalNumber, field: fPersonalNumber, value: defPositions(pn), check: pos{pn.line, pn.end}, class: classAlnum, fillerAllowed: true})
	}
	cc := must(fCompositeCheck)
	compositeCheck := pos{cc.line, cc.start}
	var compositeParts []pos
	for _, p := range composites[format] {
		compositeParts = append(compositeParts, positions(p.line, p.start, p.end)...)
	}

	passes := func(c checked) bool {
		digit := at(c.check)
		value := text(c.value)
		if c.fillerAllowed && strings.Trim(value, "<") == "" {
			return digit == '<' || digit == '0'
		}
		return checkDigitPasses(value, digit)
	}
	compositePasses := func() bool { return checkDigitPasses(text(compositeParts), at(compositeCheck)) }
	write := func(ps []pos, value string) {
		for i, p := range ps {
			set(p, value[i])
		}
	}

	// 3. FR-5: a failing field's look-alikes are tried in every combination (a
	// few at most); a combination is taken only when it makes the field's digit
	// and the composite pass, and only if no other combination does too.
	var failing []checked
	for _, c := range checks {
		if !passes(c) {
			failing = append(failing, c)
		}
	}
	ambiguous := ""
	searched := map[string]bool{}
	if len(failing) > 0 {
		choices := make([][]string, len(failing))
		all, product := true, 1
		for i, c := range failing {
			if !opts.NoNumberCorrections {
				choices[i] = candidates(c, at, write, text, passes)
			}
			if len(choices[i]) == 0 {
				all = false
			}
			product *= len(choices[i])
		}
		if all && product <= maxCompositeTries {
			original := make([]string, len(failing))
			for i, c := range failing {
				original[i] = text(c.value)
			}
			var fits [][]string
			for _, combo := range cartesian(choices) {
				for i, c := range failing {
					write(c.value, combo[i])
				}
				if compositePasses() {
					fits = append(fits, combo)
				}
			}
			for i, c := range failing {
				write(c.value, original[i])
			}
			if len(fits) == 1 {
				for i, c := range failing {
					if fits[0][i] != original[i] {
						searched[c.field] = true
					}
					write(c.value, fits[0][i])
				}
			} else if len(fits) > 1 {
				for i, c := range failing {
					seen := map[string]bool{}
					for _, f := range fits {
						seen[f[i]] = true
					}
					if len(seen) > 1 {
						ambiguous = c.name
						break
					}
				}
			}
		}
	}

	// 4. The fields' values and what is wrong with them.
	lines := make([]string, len(grid))
	for i, l := range grid {
		lines[i] = string(l)
	}
	m := &Mrz{Format: format, Lines: lines, Checks: map[string]bool{}, Spans: spans,
		Corrections: []Correction{}, Problems: []Issue{}, Notes: []Issue{}}
	problem := func(code, field string) { m.Problems = append(m.Problems, Issue{code, field}) }
	note := func(code, field string) { m.Notes = append(m.Notes, Issue{code, field}) }
	field := func(name string) string {
		d := must(name)
		return lines[d.line][d.start:d.end]
	}
	spanText := func(name string) string {
		s := findSpan(name)
		return lines[s.Line][s.Start:s.End]
	}
	trim := func(s string) string { return strings.Trim(s, "<") }

	for _, c := range checks {
		m.Checks[c.name] = passes(c)
		if !m.Checks[c.name] {
			problem(ProblemCheckDigit, c.name)
		}
	}
	m.Checks[checkComposite] = compositePasses()
	if !m.Checks[checkComposite] {
		problem(ProblemCheckDigit, checkComposite)
	}
	if ambiguous != "" {
		problem(ProblemAmbiguousCorrection, ambiguous)
	}

	for _, d := range layout {
		s := field(d.field)
		ok := mrzChars.MatchString(s)
		switch d.class {
		case classDigit:
			ok = digitsOrFiller.MatchString(s)
		case classAlpha:
			ok = lettersOrFill.MatchString(s)
		}
		if !ok {
			problem(ProblemInvalidCharacter, d.field)
		}
	}

	m.DocumentCode = trim(field(fDocumentCode))
	if strings.HasPrefix(m.DocumentCode, "V") {
		problem(ProblemUnsupportedDocument, fDocumentCode)
	}
	m.IssuingState = trim(field(fIssuingState))
	m.Nationality = trim(field(fNationality))
	if !IsKnownState(m.IssuingState) {
		problem(ProblemUnknownState, fIssuingState)
	}
	if !IsKnownState(m.Nationality) {
		problem(ProblemUnknownState, fNationality)
	}
	if m.IssuingState == SpecimenState || m.Nationality == SpecimenState {
		note(NoteSpecimen, "")
	}

	today := opts.Today
	birthRaw, expiryRaw := field(fBirthDate), field(fExpiryDate)
	birthDate, expiryDate := mrzDate(birthRaw, birth, today), mrzDate(expiryRaw, expiry, today)
	if birthDate == "" {
		if partialDate.MatchString(birthRaw) && strings.Contains(birthRaw, "<") {
			note(NoteIncompleteDate, fBirthDate)
		} else {
			problem(ProblemInvalidDate, fBirthDate)
		}
	} else {
		m.BirthDate = &birthDate
	}
	if expiryDate == "" {
		problem(ProblemInvalidDate, fExpiryDate)
	} else {
		m.ExpiryDate = &expiryDate
	}
	if birthDate != "" && birthDate > today {
		problem(ProblemBirthInFuture, fBirthDate)
	}
	if birthDate != "" && expiryDate != "" && expiryDate <= birthDate {
		problem(ProblemExpiryBeforeBirth, fExpiryDate)
	}
	if expiryDate != "" && expiryDate < today {
		note(NoteExpired, fExpiryDate)
	}

	sex := ""
	switch field(fSex) {
	case "M":
		sex = "M"
	case "F":
		sex = "F"
	case "<", "X":
		sex = "X"
	}
	if sex == "" {
		problem(ProblemInvalidSex, fSex)
	} else {
		m.Sex = &sex
	}

	m.NameField = field(fNames)
	nameParts := strings.Split(strings.TrimRight(m.NameField, "<"), "<<")
	m.Surname = strings.TrimSpace(strings.ReplaceAll(nameParts[0], "<", " "))
	m.GivenNames = strings.TrimSpace(spaces.ReplaceAllString(strings.ReplaceAll(strings.Join(nameParts[1:], " "), "<", " "), " "))
	// No check digit covers the names, so their shape is all that tells a misread: a letter three
	// times running (fillers read as L or C), name parts parted by more than <<, or a filler first
	// (a stray mark before the line moved it).
	if m.Surname == "" {
		problem(ProblemNoSurname, fNames)
	} else if tripleLetter(m.NameField) || namesSplit.MatchString(m.NameField) || strings.HasPrefix(m.NameField, "<") {
		problem(ProblemNamesUnreadable, fNames)
	}

	m.DocumentNumber = strings.TrimRight(text(docValue), "<")
	switch format {
	case TD1:
		m.OptionalData = []string{trim(spanText(fOptionalData1)), trim(field(fOptionalData2))}
	case TD2:
		m.OptionalData = []string{trim(spanText(fOptionalData2))}
	default:
		m.OptionalData = []string{trim(field(fPersonalNumber))}
	}

	// FR-6: a Lithuanian document's personal code agrees with its birth date and sex.
	if m.IssuingState == "LTU" {
		for _, s := range m.OptionalData {
			code := strings.ReplaceAll(s, "<", "")
			if len(code) != 11 || !allDigits(code) {
				continue
			}
			lt, _ := ParseLtPersonalCode(code)
			m.PersonalCode = &PersonalCode{Code: code, LtPersonalCode: lt}
			if !lt.Valid {
				f := fOptionalData1
				if format == TD3 {
					f = fPersonalNumber
				}
				problem(ProblemPersonalCodeChecksum, f)
			} else {
				if lt.BirthDate != "" && birthDate != "" && lt.BirthDate != birthDate {
					problem(ProblemPersonalCodeBirthDate, fBirthDate)
				}
				if lt.Sex != "" && sex != "" && sex != "X" && lt.Sex != sex {
					problem(ProblemPersonalCodeSex, fSex)
				}
			}
			break
		}
	}

	// What was changed, and what decided it.
	done := map[string]bool{}
	for _, s := range spans {
		changed := false
		for c := s.Start; c < s.End; c++ {
			if lines[s.Line][c] != input[s.Line][c] {
				changed = true
			}
		}
		if !changed || done[s.Field] {
			continue
		}
		done[s.Field] = true
		by := CorrectionByLayout
		if searched[s.Field] {
			by = CorrectionByLookalike
		}
		m.Corrections = append(m.Corrections, Correction{s.Field, by})
	}
	for _, c := range m.Corrections {
		note(NoteCorrected, c.Field)
	}
	m.Valid = len(m.Problems) == 0
	m.NeedsSecondRead = m.Valid && len(searched) > 0
	return m
}

// candidates are a failing field's other readings that pass its own check
// digit: each look-alike swapped, fewest swaps first, at most
// MaxTriesPerField readings tried. A digit field has none to try (its letters
// were swapped already, being impossible there).
func candidates(c checked, at func(pos) byte, write func([]pos, string), text func([]pos) string, passes func(checked) bool) []string {
	if c.class != classAlnum {
		return nil
	}
	original := text(c.value)
	var swappable []int
	for i, p := range c.value {
		if _, ok := swap[at(p)]; ok {
			swappable = append(swappable, i)
		}
	}
	var found []string
	tries := 0
outer:
	for k := 1; k <= len(swappable); k++ {
		for _, subset := range combinations(swappable, k) {
			tries++
			if tries > MaxTriesPerField {
				break outer
			}
			chars := []byte(original)
			for _, i := range subset {
				chars[i] = swap[chars[i]]
			}
			write(c.value, string(chars))
			if passes(c) {
				found = append(found, string(chars))
			}
		}
	}
	write(c.value, original)
	return found
}

// combinations are the k-subsets of items, in lexicographic order.
func combinations(items []int, k int) [][]int {
	var out [][]int
	var walk func(from int, acc []int)
	walk = func(from int, acc []int) {
		if len(acc) == k {
			out = append(out, append([]int{}, acc...))
			return
		}
		for i := from; i <= len(items)-(k-len(acc)); i++ {
			walk(i+1, append(acc, items[i]))
		}
	}
	walk(0, nil)
	return out
}

// cartesian is every combination of one choice per field, the first field's
// choices outermost.
func cartesian(options [][]string) [][]string {
	out := [][]string{{}}
	for _, opts := range options {
		var next [][]string
		for _, prefix := range out {
			for _, o := range opts {
				next = append(next, append(append([]string{}, prefix...), o))
			}
		}
		out = next
	}
	return out
}

// fillerTail: in the name field, a run of three or more fillers can only be
// the padding (names are parted by < and <<), so whatever follows it is a
// filler misread: K, C, E, L… become <.
func fillerTail(ps []pos, at func(pos) byte, set func(pos, byte)) {
	b := make([]byte, len(ps))
	for i, p := range ps {
		b[i] = at(p)
	}
	i := strings.Index(string(b), "<<<")
	if i == -1 {
		return
	}
	for j := i; j < len(ps); j++ {
		if at(ps[j]) != '<' {
			set(ps[j], '<')
		}
	}
}

// kAmongFillers: in a number's field, a K in the trailing run of fillers (a
// run that starts with < and holds nothing but < and K) is a misread filler:
// a number never resumes after its padding. A K right after the number stays;
// no check digit can say whether it is one.
func kAmongFillers(ps []pos, at func(pos) byte, set func(pos, byte)) {
	b := make([]byte, len(ps))
	for i, p := range ps {
		b[i] = at(p)
	}
	loc := numberTail.FindIndex(b)
	if loc == nil {
		return
	}
	for j := loc[0]; j < len(ps); j++ {
		if at(ps[j]) == 'K' {
			set(ps[j], '<')
		}
	}
}

// tripleLetter is whether s has a letter three times running.
func tripleLetter(s string) bool {
	for i := 0; i+2 < len(s); i++ {
		if s[i] >= 'A' && s[i] <= 'Z' && s[i] == s[i+1] && s[i] == s[i+2] {
			return true
		}
	}
	return false
}
