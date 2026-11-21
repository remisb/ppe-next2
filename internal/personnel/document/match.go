package document

import (
	"context"
	"strings"

	"github.com/google/uuid"
)

// People is the employees (People) as Match reads them: those whose names
// are alike, one by id, what one holds, and which may be one person.
// cmd/api adapts People's services; Personnel files never read their tables.
type People interface {
	// Alike are live employees whose names are the same as, or similar to,
	// first and last (employee.CompareNames), the same names first, a few.
	Alike(ctx context.Context, first, last string) ([]AlikePerson, error)
	// Person is a live employee; false when they are not (deleted, merged away).
	Person(ctx context.Context, id uuid.UUID) (Person, bool, error)
	// Holds counts the employee's live orders and the company assets they hold.
	Holds(ctx context.Context, id uuid.UUID) (orders, assets int, err error)
	// Pairs are the pairs among ids that may be one person, less those marked
	// Not the Same Person.
	Pairs(ctx context.Context, ids []uuid.UUID) ([]MatchPair, error)
}

// Person is an employee as Match compares them with a document.
type Person struct {
	ID          uuid.UUID
	FullName    string
	Code        *string
	BirthDate   *string // ISO
	Nationality *string
	Sex         *string
}

// AlikePerson is an employee whose name is like the document's, and how.
type AlikePerson struct {
	Person
	// Kind is employee.MatchKind: same_name or similar_name.
	Kind string
}

// WithPeople lets Match offer employees by name, with what they hold.
// Without it Match offers only those the document's numbers find.
func WithPeople(p People) Option { return func(s *Service) { s.people = p } }

// Why a candidate is offered, strongest first.
const (
	MatchPersonalCode   = "personal_code"
	MatchDocumentNumber = "document_number"
	MatchSameName       = "same_name"
	MatchSimilarName    = "similar_name"
)

// maxCandidates is how many employees Match offers at most.
const maxCandidates = 5

// MatchParams is a reading Scan Documents asks about: the lines, and the
// names as read from the print or typed (else the MRZ's are used).
type MatchParams struct {
	MRZ        []string
	Surname    string
	GivenNames string
}

// MatchEmployee names a candidate.
type MatchEmployee struct {
	ID       uuid.UUID `json:"id"`
	FullName string    `json:"full_name"`
	Code     *string   `json:"code"`
}

// Candidate is an employee who may be the document's holder, with what the
// app compares with the document: the record's birth date, nationality and
// sex, and how much they hold.
type Candidate struct {
	Employee     MatchEmployee `json:"employee"`
	Kind         string        `json:"kind"`
	BirthDate    *string       `json:"birth_date"`
	Nationality  *string       `json:"nationality"`
	Sex          *string       `json:"sex"`
	Orders       int           `json:"orders"`
	Assets       int           `json:"assets"`
	HasDocuments bool          `json:"has_documents"`
}

// MatchPair is two candidates who may be one person.
type MatchPair struct {
	A    uuid.UUID `json:"a"`
	B    uuid.UUID `json:"b"`
	Kind string    `json:"kind"`
}

// MatchResult is Check's answer for the lines, the candidates and their pairs.
type MatchResult struct {
	Check      CheckResult `json:"check"`
	Candidates []Candidate `json:"candidates"`
	Pairs      []MatchPair `json:"pairs"`
}

// Match finds who a document may belong to (Scan Documents' Find Employee),
// writing nothing: whoever holds its personal code, or a live document with
// its number, then employees whose names are the same or similar; each once,
// the strongest reason kept, at most five. A reading the API does not pass
// offers no one.
func (s *Service) Match(ctx context.Context, p MatchParams) (MatchResult, error) {
	check, err := s.Check(ctx, CheckParams{MRZ: p.MRZ, Surname: p.Surname, GivenNames: p.GivenNames})
	if err != nil {
		return MatchResult{}, err
	}
	res := MatchResult{Check: check, Candidates: []Candidate{}, Pairs: []MatchPair{}}
	if !check.Valid {
		return res, nil
	}
	m, err := s.parse(p.MRZ)
	if err != nil {
		return MatchResult{}, err
	}

	type found struct {
		id     uuid.UUID
		kind   string
		person *Person
	}
	var order []found
	seen := map[uuid.UUID]bool{}
	add := func(f found) {
		if f.id != uuid.Nil && !seen[f.id] {
			seen[f.id] = true
			order = append(order, f)
		}
	}
	if check.OtherEmployee != nil {
		add(found{id: *check.OtherEmployee, kind: MatchPersonalCode})
	}
	if check.DocumentOnFile != nil {
		add(found{id: check.DocumentOnFile.EmployeeID, kind: MatchDocumentNumber})
	}
	if s.people != nil {
		first, last := strings.TrimSpace(p.GivenNames), strings.TrimSpace(p.Surname)
		if last == "" {
			first, last = m.GivenNames, m.Surname
		}
		alike, err := s.people.Alike(ctx, first, last)
		if err != nil {
			return MatchResult{}, err
		}
		for _, a := range alike {
			person := a.Person
			kind := MatchSimilarName
			if a.Kind == MatchSameName {
				kind = MatchSameName
			}
			add(found{id: a.ID, kind: kind, person: &person})
		}
	}

	var ids []uuid.UUID
	for _, f := range order {
		if len(res.Candidates) == maxCandidates {
			break
		}
		person := f.person
		if person == nil {
			if s.people == nil {
				continue
			}
			got, ok, err := s.people.Person(ctx, f.id)
			if err != nil {
				return MatchResult{}, err
			}
			if !ok {
				continue
			}
			person = &got
		}
		c := Candidate{Employee: MatchEmployee{ID: person.ID, FullName: person.FullName, Code: person.Code}, Kind: f.kind,
			BirthDate: person.BirthDate, Nationality: person.Nationality, Sex: person.Sex}
		if c.Orders, c.Assets, err = s.people.Holds(ctx, person.ID); err != nil {
			return MatchResult{}, err
		}
		docs, err := s.repo.Documents(ctx, person.ID)
		if err != nil {
			return MatchResult{}, err
		}
		c.HasDocuments = len(docs) > 0
		res.Candidates = append(res.Candidates, c)
		ids = append(ids, person.ID)
	}
	if len(ids) > 1 {
		pairs, err := s.people.Pairs(ctx, ids)
		if err != nil {
			return MatchResult{}, err
		}
		res.Pairs = append(res.Pairs, pairs...)
	}
	return res, nil
}
