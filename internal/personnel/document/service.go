package document

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/personnel/mrz"
	"github.com/remisb/ppe-next2/internal/sealbox"
)

// Store keeps the copies' sealed objects (internal/files' Store).
type Store interface {
	Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
}

type Service struct {
	repo  Repository
	keys  Keys
	store Store
	now   func() time.Time
	newID func() uuid.UUID
	loc   *time.Location
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// WithLocation is the organisation's timezone (API_ORG_TIMEZONE): "today",
// for the MRZ's centuries and "expired", is its date.
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

// NewService is the identity documents' service. Without keys or a store it
// refuses everything with ErrNotConfigured.
func NewService(repo Repository, keys Keys, store Store, opts ...Option) *Service {
	s := &Service{repo: repo, keys: keys, store: store,
		now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New, loc: time.UTC}
	for _, o := range opts {
		o(s)
	}
	return s
}

func (s *Service) configured() bool { return s.keys.configured() && s.store != nil }

func (s *Service) today() string { return s.now().In(s.loc).Format(time.DateOnly) }

// CheckParams is what docs-import asks about before Save.
type CheckParams struct {
	// EmployeeID is the chosen person; uuid.Nil for a new employee.
	EmployeeID uuid.UUID
	MRZ        []string
	Surname    string
	GivenNames string
}

// CheckResult is the API's reading of the lines: the parser's problems and
// notes, and what only the API knows. No value read from the document.
type CheckResult struct {
	Valid           bool        `json:"valid"`
	Problems        []mrz.Issue `json:"problems"`
	Notes           []mrz.Issue `json:"notes"`
	NeedsSecondRead bool        `json:"needs_second_read"`
	// NameMatch is how the typed names compare with the MRZ's (same, truncated, differs).
	NameMatch mrz.NameMatchResult `json:"name_match"`
	// DocumentOnFile is the live document with this number and state, if any.
	DocumentOnFile *Ref `json:"document_on_file"`
	// OtherEmployee is the employee the personal code belongs to, when not the chosen one.
	OtherEmployee *uuid.UUID `json:"other_employee"`
	// PossibleDuplicates, for a new employee: live employees with the same names, or last name and birth date.
	PossibleDuplicates []uuid.UUID `json:"possible_duplicates"`
}

// Check re-reads the lines and says what is wrong or already on file. It
// writes nothing (FR-9).
func (s *Service) Check(ctx context.Context, p CheckParams) (CheckResult, error) {
	if !s.configured() {
		return CheckResult{}, ErrNotConfigured
	}
	m, err := s.parse(p.MRZ)
	if err != nil {
		return CheckResult{}, err
	}
	r := CheckResult{Valid: m.Valid, Problems: m.Problems, Notes: m.Notes, NeedsSecondRead: m.NeedsSecondRead,
		PossibleDuplicates: []uuid.UUID{}}
	if strings.TrimSpace(p.Surname) != "" {
		r.NameMatch = mrz.NameMatch(strings.TrimSpace(p.Surname), strings.TrimSpace(p.GivenNames), m.NameField)
	}
	if m.DocumentNumber != "" {
		ref, found, err := s.repo.DocumentByNumber(ctx, s.keys.numberIndex(m.IssuingState, m.DocumentNumber), m.IssuingState)
		if err != nil {
			return CheckResult{}, err
		}
		if found {
			r.DocumentOnFile = &ref
		}
	}
	if code := personalCodeOf(m); code != "" {
		other, found, err := s.repo.SubjectByPersonalCode(ctx, s.keys.personalIndex(code))
		if err != nil {
			return CheckResult{}, err
		}
		if found && other != p.EmployeeID {
			r.OtherEmployee = &other
		}
	}
	if p.EmployeeID == uuid.Nil {
		first, last := givenAndSurname(p.Surname, p.GivenNames, m)
		dups, err := s.repo.PossibleDuplicates(ctx, first, last, m.BirthDate)
		if err != nil {
			return CheckResult{}, err
		}
		r.PossibleDuplicates = dups
	}
	return r, nil
}

// Save keeps a reviewed document (FR-10): the objects first, sealed, then one
// transaction for the employee, the subject, the document, its copies and the
// events. A failed transaction deletes the objects it wrote.
func (s *Service) Save(ctx context.Context, p SaveParams, actor uuid.UUID) (Document, error) {
	if actor == uuid.Nil {
		return Document{}, fieldError("actor", "is required")
	}
	if !s.configured() {
		return Document{}, ErrNotConfigured
	}
	if err := p.Validate(); err != nil {
		return Document{}, err
	}
	m, err := s.parse(p.MRZ)
	if err != nil {
		return Document{}, err
	}
	if !m.Valid {
		return Document{}, &ProblemsError{Problems: m.Problems}
	}
	if (p.Kind == Passport) != strings.HasPrefix(m.DocumentCode, "P") {
		return Document{}, fieldError("kind", "does not match the document's code")
	}
	if p.IssuedOn != "" && p.IssuedOn > *m.ExpiryDate {
		return Document{}, fieldError("issued_on", "is after the expiry date")
	}

	now := s.now()
	employeeID := p.EmployeeID
	var newEmployee *EmployeeRecord
	if p.New != nil {
		employeeID = s.newID()
		newEmployee = &EmployeeRecord{ID: employeeID, FirstName: p.New.FirstName, LastName: p.New.LastName, Code: p.New.Code}
	}

	numberIndex := s.keys.numberIndex(m.IssuingState, m.DocumentNumber)
	if ref, found, err := s.repo.DocumentByNumber(ctx, numberIndex, m.IssuingState); err != nil {
		return Document{}, err
	} else if found {
		return Document{}, &DuplicateError{What: duplicateDocument, EmployeeID: ref.EmployeeID, DocumentID: ref.DocumentID}
	}
	code := personalCodeOf(m)
	var personalIndex []byte
	if code != "" {
		personalIndex = s.keys.personalIndex(code)
		if other, found, err := s.repo.SubjectByPersonalCode(ctx, personalIndex); err != nil {
			return Document{}, err
		} else if found && other != employeeID {
			return Document{}, &DuplicateError{What: duplicateOtherEmployee, EmployeeID: other}
		}
	}

	// The person's data key: theirs if they have one, else a new one.
	rec := SaveRecord{NewEmployee: newEmployee, EmployeeID: employeeID, NumberIndex: numberIndex}
	var box *sealbox.Box
	subject, found, err := s.repo.Subject(ctx, employeeID)
	if err != nil {
		return Document{}, err
	}
	if found {
		if personalIndex != nil && subject.PersonalIndex != nil && !bytes.Equal(subject.PersonalIndex, personalIndex) {
			return Document{}, fieldError("personal_code", "differs from the one on file for this person")
		}
		if box, err = s.keys.openDataKey(employeeID, subject.SealedKey, subject.KeyID); err != nil {
			return Document{}, err
		}
		if subject.PersonalIndex == nil {
			rec.PersonalIndex = personalIndex
		}
	} else {
		var sealedKey []byte
		var keyID int16
		if box, sealedKey, keyID, err = s.keys.newDataKey(employeeID); err != nil {
			return Document{}, err
		}
		rec.NewSubject = &Subject{EmployeeID: employeeID, PersonalIndex: personalIndex, SealedKey: sealedKey, KeyID: keyID}
	}

	doc := Document{
		ID: s.newID(), EmployeeID: employeeID, Kind: p.Kind, IssuingState: m.IssuingState, ExpiresOn: *m.ExpiryDate,
		OnEmployeeRecord: p.AddToEmployeeRecord, Copies: []Side{}, CreatedAt: now, CreatedByUserID: actor,
	}
	if p.IssuedOn != "" {
		doc.IssuedOn = &p.IssuedOn
	}
	fields := Fields{
		Number: m.DocumentNumber, PersonalCode: code, MRZ: m.Lines, Surname: p.Surname, GivenNames: p.GivenNames,
		Nationality: m.Nationality, PlaceOfBirth: p.PlaceOfBirth, Authority: p.Authority,
	}
	if m.BirthDate != nil {
		fields.BirthDate = *m.BirthDate
	}
	if m.Sex != nil {
		fields.Sex = *m.Sex
	}
	plain, err := json.Marshal(fields)
	if err != nil {
		return Document{}, err
	}
	if rec.Sealed, err = box.Seal(plain, documentContext(doc.ID)); err != nil {
		return Document{}, err
	}

	// The copies: sealed, then written, in a fixed order.
	sides := make([]Side, 0, len(p.Copies))
	for side := range p.Copies {
		sides = append(sides, side)
	}
	slices.Sort(sides)
	var written []string
	cleanup := func() {
		for _, key := range written {
			_ = s.store.Delete(context.WithoutCancel(ctx), key)
		}
	}
	for _, side := range sides {
		jpegBytes := p.Copies[side]
		c := Copy{ID: s.newID(), Side: side, SHA256: sha256Of(jpegBytes), Bytes: len(jpegBytes)}
		c.ObjectKey = objectKey(employeeID, doc.ID, side, c.ID)
		sealed, err := box.Seal(jpegBytes, copyContext(c.ID))
		if err != nil {
			cleanup()
			return Document{}, err
		}
		if err := s.store.Put(ctx, c.ObjectKey, bytes.NewReader(sealed), int64(len(sealed)), "application/octet-stream"); err != nil {
			cleanup()
			return Document{}, err
		}
		written = append(written, c.ObjectKey)
		rec.Copies = append(rec.Copies, c)
		doc.Copies = append(doc.Copies, side)
	}
	rec.Document = doc

	rec.Mutate = func(cur EmployeeRecord, superseded []Document) (EmployeeRecord, []audit.Event, error) {
		return s.mutate(cur, superseded, p, m, doc, newEmployee != nil, actor, now)
	}
	if err := s.repo.Save(ctx, rec); err != nil {
		cleanup()
		return Document{}, err
	}
	return doc, nil
}

// mutate is what the employee becomes and the events of a Save.
func (s *Service) mutate(cur EmployeeRecord, superseded []Document, p SaveParams, m *mrz.Mrz, doc Document,
	created bool, actor uuid.UUID, now time.Time) (EmployeeRecord, []audit.Event, error) {
	next := cur
	takes := func(t Take) bool { return p.AddToEmployeeRecord && slices.Contains(p.Take, t) }
	if takes(TakeNames) {
		next.LastName, next.FirstName = p.Surname, p.GivenNames
		if next.FirstName == "" {
			next.FirstName = cur.FirstName
		}
	}
	if takes(TakeBirthDate) && m.BirthDate != nil {
		next.BirthDate = m.BirthDate
	}
	if takes(TakeNationality) && m.Nationality != "" {
		next.Nationality = &m.Nationality
	}
	if takes(TakeSex) && m.Sex != nil {
		next.Sex = m.Sex
	}

	var events []audit.Event
	add := func(name string, before, after any) error {
		ev, err := audit.New(s.newID(), &actor, name, auditEntity, doc.EmployeeID, now, before, after)
		if err != nil {
			return err
		}
		events = append(events, ev)
		return nil
	}
	if created {
		// As employee.created records it: the sizes, none yet.
		if err := add("employee.created", nil, map[string]any{"height_cm": nil, "clothing_size": nil, "shoe_size": nil}); err != nil {
			return EmployeeRecord{}, nil, err
		}
	}
	if before, after := employeeChange(cur, next); !created && len(after) > 0 {
		if err := add("employee.updated", before, after); err != nil {
			return EmployeeRecord{}, nil, err
		}
	}
	for _, old := range superseded {
		if err := add(EventSuperseded, nil, summaryOf(old)); err != nil {
			return EmployeeRecord{}, nil, err
		}
	}
	after := summaryOf(doc)
	after["copies"] = len(doc.Copies)
	after["on_employee_record"] = doc.OnEmployeeRecord
	if err := add(EventRecorded, nil, after); err != nil {
		return EmployeeRecord{}, nil, err
	}
	return next, events, nil
}

// employeeChange is what employee.updated records of a document's changes:
// the names before and after, as the employee service records them, and that
// the birth date, nationality or sex changed, never their values.
func employeeChange(cur, next EmployeeRecord) (before, after map[string]any) {
	before, after = map[string]any{}, map[string]any{}
	if cur.FirstName != next.FirstName {
		before["first_name"], after["first_name"] = cur.FirstName, next.FirstName
	}
	if cur.LastName != next.LastName {
		before["last_name"], after["last_name"] = cur.LastName, next.LastName
	}
	for key, changed := range map[string]bool{
		"birth_date_changed":  !eq(cur.BirthDate, next.BirthDate),
		"nationality_changed": !eq(cur.Nationality, next.Nationality),
		"sex_changed":         !eq(cur.Sex, next.Sex),
	} {
		if changed {
			after[key] = true
		}
	}
	return before, after
}

// summaryOf is what events say of a document: never a sealed field.
func summaryOf(d Document) map[string]any {
	return map[string]any{
		"document_id": d.ID, "kind": d.Kind, "issuing_state": d.IssuingState,
		"issued_on": d.IssuedOn, "expires_on": d.ExpiresOn,
	}
}

// Validity is what anyone may know of a person's documents: each current
// one's kind, issuing state and expiry date (FR-15), never more.
type Validity struct {
	Kind         Kind   `json:"kind"`
	IssuingState string `json:"issuing_state"`
	ExpiresOn    string `json:"expires_on"`
}

// Validity is the employee's current documents' validity, for the employee
// page's "valid until" line.
func (s *Service) Validity(ctx context.Context, employeeID uuid.UUID) ([]Validity, error) {
	docs, err := s.repo.Documents(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	out := make([]Validity, 0, len(docs))
	for _, d := range docs {
		if d.SupersededAt == nil {
			out = append(out, Validity{Kind: d.Kind, IssuingState: d.IssuingState, ExpiresOn: d.ExpiresOn})
		}
	}
	return out, nil
}

// Documents are the employee's live documents (the summary; FR-15, D11).
func (s *Service) Documents(ctx context.Context, employeeID uuid.UUID) ([]Document, error) {
	return s.repo.Documents(ctx, employeeID)
}

// parse reads the lines with the API's own parser (NFR-7).
func (s *Service) parse(lines []string) (*mrz.Mrz, error) {
	clean := make([]string, len(lines))
	for i, l := range lines {
		clean[i] = strings.ToUpper(strings.TrimSpace(l))
	}
	m := mrz.Parse(clean, mrz.Options{Today: s.today()})
	if m == nil {
		return nil, fieldError("mrz", "is not a passport's or ID card's machine-readable zone")
	}
	if m.ExpiryDate == nil && m.Valid {
		return nil, errors.New("document: a valid MRZ without an expiry date")
	}
	return m, nil
}

// personalCodeOf is the personal code the document carries: a Lithuanian one
// the parser recognised. Other states' optional data is kept in the MRZ only.
func personalCodeOf(m *mrz.Mrz) string {
	if m.PersonalCode != nil && m.PersonalCode.Valid {
		return m.PersonalCode.Code
	}
	return ""
}

// givenAndSurname are the names to look for duplicates by: the printed ones,
// else the MRZ's.
func givenAndSurname(surname, given string, m *mrz.Mrz) (string, string) {
	surname, given = strings.TrimSpace(surname), strings.TrimSpace(given)
	if surname == "" {
		return m.GivenNames, m.Surname
	}
	return given, surname
}

func eq(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }
