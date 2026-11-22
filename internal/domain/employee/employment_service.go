package employee

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// The employments' audit events, on the employee (docs/specs/employee-service.md,
// "Employment"). Each names the period (employment_id) and its company.
const (
	// EventEmployed: a period opened (Add New Employee for an employee, Employ,
	// Move to Another Company); after is its company and first day.
	EventEmployed = "employee.employed"
	// EventEmploymentChanged: a period's company or dates edited, before and after.
	EventEmploymentChanged = "employee.employment_changed"
	// EventEmploymentEnded: an open period ended (End Employment, Move to
	// Another Company); after is its last day.
	EventEmploymentEnded = "employee.employment_ended"
	// EventEmploymentRemoved: a period entered by mistake removed; before is it.
	EventEmploymentRemoved = "employee.employment_removed"
)

// Companies answers whether a company is live, and its name (Companies,
// docs/specs/company-service.md); adapted in cmd/api.
type Companies interface {
	CompanyName(ctx context.Context, id uuid.UUID) (name string, ok bool, err error)
}

// companyName is the live company's name, or ErrCompanyNotFound.
func (s *Service) companyName(ctx context.Context, id uuid.UUID) (string, error) {
	if s.companies == nil {
		return "", ErrCompanyNotFound
	}
	name, ok, err := s.companies.CompanyName(ctx, id)
	switch {
	case err != nil:
		return "", err
	case !ok:
		return "", ErrCompanyNotFound
	}
	return name, nil
}

// periodJSON is a period as its events record it.
type periodJSON struct {
	EmploymentID uuid.UUID `json:"employment_id"`
	CompanyID    uuid.UUID `json:"company_id"`
	Company      string    `json:"company"`
	StartedOn    *string   `json:"started_on"`
	EndedOn      *string   `json:"ended_on"`
}

func periodOf(m Employment) periodJSON {
	return periodJSON{EmploymentID: m.ID, CompanyID: m.CompanyID, Company: m.CompanyName, StartedOn: m.StartedOn, EndedOn: m.EndedOn}
}

// employ builds a new open period of e at p's company and its event.
func (s *Service) employ(ctx context.Context, e Employee, p EmployParams, actor uuid.UUID, now time.Time) (Employment, audit.Event, error) {
	name, err := s.companyName(ctx, p.CompanyID)
	if err != nil {
		return Employment{}, audit.Event{}, err
	}
	job := Employment{
		ID: s.newID(), EmployeeID: e.ID, CompanyID: p.CompanyID, CompanyName: name, StartedOn: p.StartedOn,
		CreatedAt: now, UpdatedAt: now, CreatedByUserID: actor, UpdatedByUserID: actor,
	}
	ev, err := s.event(actor, EventEmployed, e.ID, now, nil, periodOf(job))
	if err != nil {
		return Employment{}, audit.Event{}, err
	}
	return job, *ev, nil
}

// checkOverlap refuses job when it shares days with another of jobs.
func checkOverlap(job Employment, jobs []Employment) error {
	for _, o := range jobs {
		if o.ID != job.ID && overlaps(job, o) {
			return fmt.Errorf("%w: %s %s–%s", ErrOverlap, o.CompanyName, dateOr(o.StartedOn, "…"), dateOr(o.EndedOn, "…"))
		}
	}
	return nil
}

func dateOr(d *string, none string) string {
	if d == nil {
		return none
	}
	return *d
}

// find is the live period id among jobs.
func find(jobs []Employment, id uuid.UUID) (Employment, error) {
	for _, m := range jobs {
		if m.ID == id {
			return m, nil
		}
	}
	return Employment{}, ErrEmploymentNotFound
}

// guard is what every employment change checks first.
func guard(may Rights, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	if !may.Profile {
		return ErrNotPermitted
	}
	return nil
}

// Employ opens a period at p's company for a candidate or a former employee,
// recording employee.employed. An employee employed now is refused
// (ErrEmployed) unless p.EndCurrent (Move to Another Company), which ends the
// open period on p.StartedOn first (employee.employment_ended). The new period
// must not overlap another. It needs may.Profile.
func (s *Service) Employ(ctx context.Context, id uuid.UUID, p EmployParams, may Rights, actor uuid.UUID) (Employee, error) {
	if err := guard(may, actor); err != nil {
		return Employee{}, err
	}
	if err := p.Validate(); err != nil {
		return Employee{}, err
	}
	e, err := s.repo.UpdateEmployments(ctx, id, func(cur Employee, jobs []Employment) ([]Employment, []audit.Event, error) {
		now := s.now()
		var writes []Employment
		var evs []audit.Event
		others := jobs
		for i, m := range jobs {
			if !m.Open() {
				continue
			}
			if !p.EndCurrent {
				return nil, nil, fmt.Errorf("%w at %s", ErrEmployed, m.CompanyName)
			}
			if m.StartedOn != nil && *p.StartedOn < *m.StartedOn {
				return nil, nil, fieldError("started_on", "must not be before the current employment's start")
			}
			ended, ev, err := s.end(cur.ID, m, *p.StartedOn, actor, now)
			if err != nil {
				return nil, nil, err
			}
			others = append(append([]Employment{}, jobs[:i]...), jobs[i+1:]...)
			others = append(others, ended)
			writes, evs = append(writes, ended), append(evs, ev)
		}
		job, ev, err := s.employ(ctx, cur, p, actor, now)
		if err != nil {
			return nil, nil, err
		}
		if err := checkOverlap(job, others); err != nil {
			return nil, nil, err
		}
		return append(writes, job), append(evs, ev), nil
	})
	if err != nil {
		return Employee{}, err
	}
	return s.withEmployments(ctx, e)
}

// end is m ended on day, with its event.
func (s *Service) end(employeeID uuid.UUID, m Employment, day string, actor uuid.UUID, now time.Time) (Employment, audit.Event, error) {
	if m.StartedOn != nil && day < *m.StartedOn {
		return Employment{}, audit.Event{}, fieldError("ended_on", "must not be before started_on")
	}
	next := m
	next.EndedOn, next.UpdatedAt, next.UpdatedByUserID = &day, now, actor
	ev, err := s.event(actor, EventEmploymentEnded, employeeID, now, nil, periodOf(next))
	if err != nil {
		return Employment{}, audit.Event{}, err
	}
	return next, *ev, nil
}

// EndEmployment ends the open period jobID on endedOn (the day the employee
// left), recording employee.employment_ended; the employee becomes a former
// employee. An ended period is ErrEnded. It needs may.Profile.
func (s *Service) EndEmployment(ctx context.Context, id, jobID uuid.UUID, endedOn string, may Rights, actor uuid.UUID) (Employee, error) {
	if err := guard(may, actor); err != nil {
		return Employee{}, err
	}
	day := &endedOn
	if day = blankToNil(day); day == nil {
		return Employee{}, fieldError("ended_on", "is required")
	}
	if err := checkDate("ended_on", day); err != nil {
		return Employee{}, err
	}
	e, err := s.repo.UpdateEmployments(ctx, id, func(cur Employee, jobs []Employment) ([]Employment, []audit.Event, error) {
		m, err := find(jobs, jobID)
		if err != nil {
			return nil, nil, err
		}
		if !m.Open() {
			return nil, nil, ErrEnded
		}
		ended, ev, err := s.end(cur.ID, m, *day, actor, s.now())
		if err != nil {
			return nil, nil, err
		}
		return []Employment{ended}, []audit.Event{ev}, nil
	})
	if err != nil {
		return Employee{}, err
	}
	return s.withEmployments(ctx, e)
}

// UpdateEmployment replaces period jobID's company and dates (correcting a
// mistake), recording employee.employment_changed with what changed. Opening
// an ended period while another is open is ErrEmployed; the period must not
// overlap another. It needs may.Profile.
func (s *Service) UpdateEmployment(ctx context.Context, id, jobID uuid.UUID, p EmploymentParams, may Rights, actor uuid.UUID) (Employee, error) {
	if err := guard(may, actor); err != nil {
		return Employee{}, err
	}
	if err := p.Validate(); err != nil {
		return Employee{}, err
	}
	e, err := s.repo.UpdateEmployments(ctx, id, func(cur Employee, jobs []Employment) ([]Employment, []audit.Event, error) {
		m, err := find(jobs, jobID)
		if err != nil {
			return nil, nil, err
		}
		next := m
		next.CompanyID, next.StartedOn, next.EndedOn = p.CompanyID, p.StartedOn, p.EndedOn
		if next.CompanyID != m.CompanyID {
			if next.CompanyName, err = s.companyName(ctx, next.CompanyID); err != nil {
				return nil, nil, err
			}
		}
		if next.CompanyID == m.CompanyID && eqPtr(next.StartedOn, m.StartedOn) && eqPtr(next.EndedOn, m.EndedOn) {
			return nil, nil, nil
		}
		if next.Open() {
			for _, o := range jobs {
				if o.ID != m.ID && o.Open() {
					return nil, nil, fmt.Errorf("%w at %s", ErrEmployed, o.CompanyName)
				}
			}
		}
		if err := checkOverlap(next, jobs); err != nil {
			return nil, nil, err
		}
		now := s.now()
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		before, after := map[string]any{"employment_id": m.ID}, map[string]any{"employment_id": m.ID}
		if next.CompanyID != m.CompanyID {
			before["company_id"], after["company_id"] = m.CompanyID, next.CompanyID
			before["company"], after["company"] = m.CompanyName, next.CompanyName
		} else {
			after["company"] = m.CompanyName
		}
		if !eqPtr(next.StartedOn, m.StartedOn) {
			before["started_on"], after["started_on"] = m.StartedOn, next.StartedOn
		}
		if !eqPtr(next.EndedOn, m.EndedOn) {
			before["ended_on"], after["ended_on"] = m.EndedOn, next.EndedOn
		}
		ev, err := s.event(actor, EventEmploymentChanged, cur.ID, now, before, after)
		if err != nil {
			return nil, nil, err
		}
		return []Employment{next}, []audit.Event{*ev}, nil
	})
	if err != nil {
		return Employee{}, err
	}
	return s.withEmployments(ctx, e)
}

// RemoveEmployment removes period jobID, entered by mistake (a soft delete),
// recording employee.employment_removed. Removing the only period makes the
// person a candidate again. It needs may.Profile.
func (s *Service) RemoveEmployment(ctx context.Context, id, jobID uuid.UUID, may Rights, actor uuid.UUID) (Employee, error) {
	if err := guard(may, actor); err != nil {
		return Employee{}, err
	}
	e, err := s.repo.UpdateEmployments(ctx, id, func(cur Employee, jobs []Employment) ([]Employment, []audit.Event, error) {
		m, err := find(jobs, jobID)
		if err != nil {
			return nil, nil, err
		}
		now := s.now()
		next := m
		next.DeletedAt, next.DeletedByUserID = &now, &actor
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		ev, err := s.event(actor, EventEmploymentRemoved, cur.ID, now, periodOf(m), nil)
		if err != nil {
			return nil, nil, err
		}
		return []Employment{next}, []audit.Event{*ev}, nil
	})
	if err != nil {
		return Employee{}, err
	}
	return s.withEmployments(ctx, e)
}

// withEmployments is e with its live employments, as Get answers.
func (s *Service) withEmployments(ctx context.Context, e Employee) (Employee, error) {
	jobs, err := s.repo.Employments(ctx, e.ID)
	if err != nil {
		return Employee{}, err
	}
	e.Employments = jobs
	return e, nil
}
