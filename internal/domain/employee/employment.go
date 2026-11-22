package employee

import (
	"time"

	"github.com/google/uuid"
)

// Status is where a person stands with the organisation, derived from their
// employments (docs/specs/employee-service.md, "Employment"): never stored.
type Status string

const (
	// StatusEmployee: one employment is open (no end).
	StatusEmployee Status = "employee"
	// StatusFormer: every employment has ended.
	StatusFormer Status = "former"
	// StatusCandidate: no employment at all; may be employed later.
	StatusCandidate Status = "candidate"
)

// Valid reports whether s is one of the three statuses.
func (s Status) Valid() bool {
	return s == StatusEmployee || s == StatusFormer || s == StatusCandidate
}

// CompanyRef names a company: the employer of the open employment.
type CompanyRef struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// Employment is one period of an employee at a company (migration 0058), a
// child of the employee: it is changed only through the employee, under the
// employee's row lock. Dates are ISO (YYYY-MM-DD). A period runs from
// StartedOn to EndedOn, the day the employee left, so the next may start that
// day; a nil StartedOn is not recorded (periods opened by the migration), a
// nil EndedOn is open. At most one is open, and none overlap.
type Employment struct {
	ID         uuid.UUID `json:"id"`
	EmployeeID uuid.UUID `json:"employee_id"`
	CompanyID  uuid.UUID `json:"company_id"`
	// CompanyName is the company's name now, deleted or not; reads fill it.
	CompanyName     string     `json:"company_name"`
	StartedOn       *string    `json:"started_on"`
	EndedOn         *string    `json:"ended_on"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"-"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID uuid.UUID  `json:"updated_by_user_id"`
	DeletedByUserID *uuid.UUID `json:"-"`
}

// Open reports whether the period has not ended.
func (m Employment) Open() bool { return m.EndedOn == nil }

// overlaps reports whether periods a and b share a day: [start, end) with a
// missing start reaching back and a missing end forward.
func overlaps(a, b Employment) bool {
	before := func(start, end *string) bool { // start < end, nil start is -inf, nil end +inf
		return start == nil || end == nil || *start < *end
	}
	return before(a.StartedOn, b.EndedOn) && before(b.StartedOn, a.EndedOn)
}

// EmployParams are Employ's (and Add New Employee's for an employee): the
// company and the first day, optional. With EndCurrent (Move to Another
// Company) an open employment is ended on StartedOn first; without it, an open
// one refuses (ErrEmployed).
type EmployParams struct {
	CompanyID  uuid.UUID
	StartedOn  *string
	EndCurrent bool
}

// Validate checks the company is named and the date's shape; a blank date
// becomes nil.
func (p *EmployParams) Validate() error {
	p.StartedOn = blankToNil(p.StartedOn)
	if p.CompanyID == uuid.Nil {
		return fieldError("company_id", "is required")
	}
	if p.EndCurrent && p.StartedOn == nil {
		return fieldError("started_on", "is required to move to another company")
	}
	return checkDate("started_on", p.StartedOn)
}

// EmploymentParams replace a period's company and dates (Edit Employment).
type EmploymentParams struct {
	CompanyID uuid.UUID
	StartedOn *string
	EndedOn   *string
}

// Validate checks the company, the dates' shapes and their order.
func (p *EmploymentParams) Validate() error {
	p.StartedOn, p.EndedOn = blankToNil(p.StartedOn), blankToNil(p.EndedOn)
	if p.CompanyID == uuid.Nil {
		return fieldError("company_id", "is required")
	}
	if err := checkDate("started_on", p.StartedOn); err != nil {
		return err
	}
	if err := checkDate("ended_on", p.EndedOn); err != nil {
		return err
	}
	if p.StartedOn != nil && p.EndedOn != nil && *p.EndedOn < *p.StartedOn {
		return fieldError("ended_on", "must not be before started_on")
	}
	return nil
}

// checkDate refuses a date that is not YYYY-MM-DD between 1900 and 2100; nil passes.
func checkDate(field string, d *string) error {
	if d == nil {
		return nil
	}
	t, err := time.Parse(time.DateOnly, *d)
	if err != nil || t.Year() < 1900 || t.Year() > 2100 {
		return fieldError(field, "must be a date (YYYY-MM-DD)")
	}
	return nil
}

// statusOf derives the status from the live employments.
func statusOf(jobs []Employment) Status {
	if len(jobs) == 0 {
		return StatusCandidate
	}
	for _, m := range jobs {
		if m.Open() {
			return StatusEmployee
		}
	}
	return StatusFormer
}
