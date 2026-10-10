package asset

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
)

// Audit event names and entity type written by this service.
const (
	EventRegistered         = "asset.registered"
	EventUpdated            = "asset.updated"
	EventStatusChanged      = "asset.status_changed"
	EventGiven              = "asset.given"
	EventReturned           = "asset.returned"
	EventMarkedNotReturned  = "asset.marked_not_returned"
	EventSignedCopyUploaded = "asset.signed_copy_uploaded"
	auditEntity             = "asset"
	maxSuggestTries         = 1000
)

type Service struct {
	repo  Repository
	files files.Store
	now   func() time.Time
	newID func() uuid.UUID
	loc   *time.Location
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// WithLocation sets the organisation timezone: "today", and so the latest
// given or return date and Days Held, are its calendar days.
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New, loc: time.UTC}
	for _, o := range opts {
		o(s)
	}
	return s
}

// AssignmentView is an assignment with its Days Held: whole days from the
// given date to the return date, or to today while it is open (§10).
type AssignmentView struct {
	Assignment
	DaysHeld int `json:"days_held"`
}

// View is an asset with where it is, its open assignment, and whether giving
// it needs a signed form (so the apps follow the rule rather than repeat it).
type View struct {
	Asset
	Location  Location        `json:"location"`
	Open      *AssignmentView `json:"open_assignment"`
	NeedsForm bool            `json:"needs_form"`
}

// Detail is an asset's page: the asset and every assignment, newest first.
type Detail struct {
	View
	Assignments []AssignmentView `json:"assignments"`
}

// HeldView is one of an employee's assignments, with its asset.
type HeldView struct {
	AssignmentView
	Asset Asset `json:"asset"`
}

func (s *Service) today() string { return s.now().In(s.loc).Format(time.DateOnly) }

func daysBetween(from, to string) int {
	a, errA := time.Parse(time.DateOnly, from)
	b, errB := time.Parse(time.DateOnly, to)
	if errA != nil || errB != nil || b.Before(a) {
		return 0
	}
	return int(b.Sub(a).Hours() / 24)
}

func (s *Service) assignmentView(a Assignment) AssignmentView {
	end := s.today()
	if a.ReturnedDate != nil {
		end = *a.ReturnedDate
	}
	return AssignmentView{Assignment: a, DaysHeld: daysBetween(a.GivenDate, end)}
}

// view derives the location from the open assignment: none is the Office;
// marked Not Returned with unknown whereabouts is Unknown, the holder kept.
func (s *Service) view(r Record) View {
	v := View{Asset: r.Asset, Location: LocationOffice, NeedsForm: r.Asset.NeedsForm()}
	if r.Open != nil {
		av := s.assignmentView(*r.Open)
		v.Open, v.Location = &av, LocationWithEmployee
		if r.Open.Whereabouts != nil && *r.Open.Whereabouts == WhereaboutsUnknown {
			v.Location = LocationUnknown
		}
	}
	return v
}

func (s *Service) event(actor uuid.UUID, name string, id uuid.UUID, at time.Time, before, after any) (audit.Event, error) {
	return audit.New(s.newID(), &actor, name, auditEntity, id, at, before, after)
}

// facts are an asset's details as events record them. The comment is free
// text, so a change to it is recorded as comment_changed, never its text.
func facts(a Asset) map[string]any {
	return map[string]any{
		"kind": a.Kind, "category": a.Category, "inventory_no": a.InventoryNo, "name": a.Name, "serial_no": a.SerialNo,
		"sim_no": a.SimNo, "phone_no": a.PhoneNo, "provider": a.Provider, "plan": a.Plan,
		"non_return_value_cents": a.NonReturnValueCents, "connection_status": a.ConnectionStatus, "received_date": a.ReceivedDate,
	}
}

// detailsChange is what asset.updated records: each changed detail before and after.
func detailsChange(cur, next Asset) (before, after map[string]any) {
	before, after = map[string]any{}, map[string]any{}
	set := func(key string, changed bool, b, a any) {
		if changed {
			before[key], after[key] = b, a
		}
	}
	set("inventory_no", cur.InventoryNo != next.InventoryNo, cur.InventoryNo, next.InventoryNo)
	set("category", !eqPtr(cur.Category, next.Category), cur.Category, next.Category)
	set("name", !eqPtr(cur.Name, next.Name), cur.Name, next.Name)
	set("serial_no", !eqPtr(cur.SerialNo, next.SerialNo), cur.SerialNo, next.SerialNo)
	set("sim_no", !eqPtr(cur.SimNo, next.SimNo), cur.SimNo, next.SimNo)
	set("phone_no", !eqPtr(cur.PhoneNo, next.PhoneNo), cur.PhoneNo, next.PhoneNo)
	set("provider", !eqPtr(cur.Provider, next.Provider), cur.Provider, next.Provider)
	set("plan", !eqPtr(cur.Plan, next.Plan), cur.Plan, next.Plan)
	set("non_return_value_cents", !eqPtr(cur.NonReturnValueCents, next.NonReturnValueCents), cur.NonReturnValueCents, next.NonReturnValueCents)
	set("received_date", !eqPtr(cur.ReceivedDate, next.ReceivedDate), cur.ReceivedDate, next.ReceivedDate)
	if cur.Comment != next.Comment {
		after["comment_changed"] = true
	}
	return before, after
}

func eqPtr[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// checkDate refuses a date after today in the organisation timezone.
func (s *Service) checkDate(field, date string) error {
	if !isDate(date) {
		return fieldError(field, "must be a date, YYYY-MM-DD")
	}
	if date > s.today() {
		return fieldError(field, "can't be later than today")
	}
	return nil
}

// duplicate names the asset that already has the number, so the app can link
// to it (§4).
func (s *Service) duplicate(ctx context.Context, err error, a Asset) error {
	var owner uuid.UUID
	var lookErr error
	switch {
	case errors.Is(err, ErrInventoryNoTaken):
		owner, lookErr = s.repo.NumberOwner(ctx, a.InventoryNo)
	case errors.Is(err, ErrSIMNoTaken) && a.SimNo != nil:
		owner, lookErr = s.repo.SIMOwner(ctx, *a.SimNo)
	default:
		return err
	}
	if lookErr != nil {
		return err
	}
	if errors.Is(err, ErrInventoryNoTaken) {
		return &DuplicateError{Err: ErrInventoryNoTaken, Existing: owner}
	}
	return &DuplicateError{Err: ErrSIMNoTaken, Existing: owner}
}

// Create is Add SIM and Add Asset (§4, §15): one asset, Office, with no
// holder. A SIM card is Not Activated and received today unless stated.
func (s *Service) Create(ctx context.Context, p CreateParams, actor uuid.UUID) (View, error) {
	if actor == uuid.Nil {
		return View{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return View{}, err
	}
	now := s.now()
	a := Asset{
		ID: s.newID(), Kind: p.Kind, Category: p.Category, InventoryNo: p.InventoryNo, Name: p.Name, SerialNo: p.SerialNo,
		SimNo: p.SimNo, PhoneNo: p.PhoneNo, Provider: p.Provider, Plan: p.Plan, NonReturnValueCents: p.NonReturnValueCents,
		Currency: Currency, Comment: p.Comment,
		CreatedAt: now, UpdatedAt: now, CreatedByUserID: actor, UpdatedByUserID: actor,
	}
	if a.Kind == KindSIM {
		status := StatusNotActivated
		if p.ConnectionStatus != nil {
			status = *p.ConnectionStatus
		}
		received := s.today()
		if p.ReceivedDate != nil {
			received = *p.ReceivedDate
		}
		if err := s.checkDate("received_date", received); err != nil {
			return View{}, err
		}
		a.ConnectionStatus, a.ReceivedDate = &status, &received
	}
	bump := BumpOf(a)
	ev, err := s.event(actor, EventRegistered, a.ID, now, nil, facts(a))
	if err != nil {
		return View{}, err
	}
	if err := s.repo.Create(ctx, a, bump, ev); err != nil {
		return View{}, s.duplicate(ctx, err, a)
	}
	return s.view(Record{Asset: a}), nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Detail, error) {
	r, err := s.repo.Get(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	as, err := s.repo.Assignments(ctx, id)
	if err != nil {
		return Detail{}, err
	}
	d := Detail{View: s.view(r), Assignments: make([]AssignmentView, len(as))}
	for i, a := range as {
		d.Assignments[i] = s.assignmentView(a)
	}
	return d, nil
}

// List is the register: one page of one kind's assets.
func (s *Service) List(ctx context.Context, p ListParams) (ListResult, error) {
	f, page, size, err := p.filter()
	if err != nil {
		return ListResult{}, err
	}
	rs, total, err := s.repo.List(ctx, f)
	if err != nil {
		return ListResult{}, err
	}
	out := ListResult{Assets: make([]View, len(rs)), Page: page, PageSize: size, Total: total}
	for i, r := range rs {
		out.Assets[i] = s.view(r)
	}
	return out, nil
}

// Summary is the register's tiles for kind.
func (s *Service) Summary(ctx context.Context, kind string) (Summary, error) {
	if !Kind(kind).valid() {
		return Summary{}, fieldError("kind", "must be SIM or EQUIPMENT")
	}
	return s.repo.Summary(ctx, Kind(kind))
}

// ByNumber is ⌘K Search's filter: SIM, phone or inventory numbers containing
// q, spaces ignored. A blank query matches nothing.
func (s *Service) ByNumber(ctx context.Context, q string) ([]View, error) {
	q = compactSIM(strings.TrimSpace(q))
	if q == "" {
		return make([]View, 0), nil
	}
	rs, err := s.repo.ByNumber(ctx, q, numberLimit)
	if err != nil {
		return nil, err
	}
	out := make([]View, len(rs))
	for i, r := range rs {
		out[i] = s.view(r)
	}
	return out, nil
}

// ByEmployee is what an employee holds and held, open first (§18).
func (s *Service) ByEmployee(ctx context.Context, employeeID uuid.UUID) ([]HeldView, error) {
	hs, err := s.repo.ByEmployee(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	out := make([]HeldView, len(hs))
	for i, h := range hs {
		out[i] = HeldView{AssignmentView: s.assignmentView(h.Assignment), Asset: h.Asset}
	}
	return out, nil
}

// HeldBy is the inventory numbers of the assets an employee holds now.
func (s *Service) HeldBy(ctx context.Context, employeeID uuid.UUID) ([]string, error) {
	hs, err := s.repo.ByEmployee(ctx, employeeID)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, h := range hs {
		if h.Assignment.Open() {
			out = append(out, h.Asset.InventoryNo)
		}
	}
	return out, nil
}

// NextNumber suggests prefix's next inventory number: after its counter,
// skipping any number an asset ever used (§16).
func (s *Service) NextNumber(ctx context.Context, prefix string) (string, error) {
	if !IsPrefix(prefix) {
		return "", fieldError("prefix", "must be SIM, PC, PH, DRV, FUR or AST")
	}
	last, err := s.repo.LastNumber(ctx, prefix)
	if err != nil {
		return "", err
	}
	for n := last + 1; n <= last+maxSuggestTries; n++ {
		number := FormatNumber(prefix, n)
		_, err := s.repo.NumberOwner(ctx, number)
		if errors.Is(err, ErrNotFound) {
			return number, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("asset: no free %s number after %d", prefix, last)
}

// Update is Edit: the details only, never the status, location or holder.
// A plan or value change never alters a stored form.
func (s *Service) Update(ctx context.Context, id uuid.UUID, p Params, actor uuid.UUID) (View, error) {
	if actor == uuid.Nil {
		return View{}, fieldError("actor", "is required")
	}
	var proposed Asset
	r, err := s.repo.Update(ctx, id, func(cur Asset, _ *Assignment) (Asset, []audit.Event, error) {
		if err := p.Validate(cur.Kind); err != nil {
			return cur, nil, err
		}
		next := cur
		next.Category, next.InventoryNo, next.Name, next.SerialNo = p.Category, p.InventoryNo, p.Name, p.SerialNo
		next.SimNo, next.PhoneNo, next.Provider, next.Plan = p.SimNo, p.PhoneNo, p.Provider, p.Plan
		next.NonReturnValueCents, next.Comment = p.NonReturnValueCents, p.Comment
		if cur.Kind == KindSIM {
			if p.ReceivedDate == nil {
				return cur, nil, fieldError("received_date", "is required")
			}
			if err := s.checkDate("received_date", *p.ReceivedDate); err != nil {
				return cur, nil, err
			}
			next.ReceivedDate = p.ReceivedDate
		}
		proposed = next
		before, after := detailsChange(cur, next)
		if len(after) == 0 {
			return cur, nil, nil
		}
		now := s.now()
		next.UpdatedAt, next.UpdatedByUserID = now, actor
		ev, err := s.event(actor, EventUpdated, cur.ID, now, before, after)
		if err != nil {
			return cur, nil, err
		}
		return next, []audit.Event{ev}, nil
	})
	if err != nil {
		return View{}, s.duplicate(ctx, err, proposed)
	}
	return s.view(r), nil
}

// ChangeStatus records the connection status the provider confirmed (§5). It
// is saved at once; it never moves the card or changes its holder, and
// choosing the current status writes nothing.
func (s *Service) ChangeStatus(ctx context.Context, id uuid.UUID, status string, actor uuid.UUID) (View, error) {
	if actor == uuid.Nil {
		return View{}, fieldError("actor", "is required")
	}
	next := Status(status)
	if !next.valid() {
		return View{}, fieldError("connection_status", "must be NOT_ACTIVATED, ACTIVE or BLOCKED")
	}
	r, err := s.repo.Update(ctx, id, func(cur Asset, _ *Assignment) (Asset, []audit.Event, error) {
		if cur.Kind != KindSIM {
			return cur, nil, fieldError("connection_status", "is for SIM cards only")
		}
		if cur.ConnectionStatus != nil && *cur.ConnectionStatus == next {
			return cur, nil, nil
		}
		now := s.now()
		ev, err := s.event(actor, EventStatusChanged, cur.ID, now,
			map[string]any{"connection_status": cur.ConnectionStatus}, map[string]any{"connection_status": next})
		if err != nil {
			return cur, nil, err
		}
		cur.ConnectionStatus, cur.UpdatedAt, cur.UpdatedByUserID = &next, now, actor
		return cur, []audit.Event{ev}, nil
	})
	if err != nil {
		return View{}, err
	}
	return s.view(r), nil
}

// FormParams are the form's inputs: the employee, the given date, and the
// plan or value when the asset lacks them (§6: "missing ones are filled in").
type FormParams struct {
	EmployeeID          uuid.UUID
	GivenDate           string
	Plan                *string
	NonReturnValueCents *int64
}

func (s *Service) checkForm(p *FormParams) error {
	p.Plan = blankToNil(p.Plan)
	switch {
	case p.EmployeeID == uuid.Nil:
		return fieldError("employee_id", "is required")
	case p.Plan != nil && len(*p.Plan) > maxTextLen:
		return fieldError("plan", "is too long")
	case p.NonReturnValueCents != nil && (*p.NonReturnValueCents < 0 || *p.NonReturnValueCents > maxValueCents):
		return fieldError("non_return_value_cents", "must be between 0 and 10000000000")
	}
	return s.checkDate("given_date", p.GivenDate)
}

// fill sets a missing plan or value from p. Changing one the asset already
// has is Edit's job.
func fill(a Asset, p FormParams) (Asset, error) {
	if p.Plan != nil {
		switch {
		case a.Kind != KindSIM:
			return a, fieldError("plan", "is for SIM cards only")
		case a.Plan != nil && *a.Plan != *p.Plan:
			return a, fieldError("plan", "is already set on the asset; change it with Edit")
		}
		a.Plan = p.Plan
	}
	if p.NonReturnValueCents != nil {
		if a.NonReturnValueCents != nil && *a.NonReturnValueCents != *p.NonReturnValueCents {
			return a, fieldError("non_return_value_cents", "is already set on the asset; change it with Edit")
		}
		a.NonReturnValueCents = p.NonReturnValueCents
	}
	if missing := a.missingFormData(); missing != "" {
		return a, fieldError(missing, "is needed for the form")
	}
	return a, nil
}

// Preview builds the form Give would store, and its hash, without writing:
// Preview Form and Print Form. Printing is not giving (§8).
func (s *Service) Preview(ctx context.Context, id uuid.UUID, p FormParams) (FormResult, error) {
	if err := s.checkForm(&p); err != nil {
		return FormResult{}, err
	}
	r, err := s.repo.Get(ctx, id)
	if err != nil {
		return FormResult{}, err
	}
	if !r.Asset.NeedsForm() {
		return FormResult{}, ErrNoForm
	}
	emp, err := s.repo.Employee(ctx, p.EmployeeID)
	if err != nil {
		return FormResult{}, err
	}
	a, err := fill(r.Asset, p)
	if err != nil {
		return FormResult{}, err
	}
	b, hash := formOf(a, emp, p.GivenDate).encode()
	return FormResult{Form: b, DocumentHash: hash}, nil
}

// GiveParams are Give SIM's and Give Asset's form. FormHash is the hash
// Preview returned for the form that was printed and signed.
type GiveParams struct {
	FormParams
	Comment         string
	PaperFormSigned bool
	FormHash        string
}

// Give registers that an asset was given (§6, §7, §17). The asset must be in
// the Office with no holder and, a SIM card, Active. When it needs a form the
// employee has signed the printed one, and that printed form must be the one
// built now. In one transaction it fills a missing plan or value, stores the
// assignment with its form and records the events.
func (s *Service) Give(ctx context.Context, id uuid.UUID, p GiveParams, actor uuid.UUID) (AssignmentView, error) {
	if actor == uuid.Nil {
		return AssignmentView{}, fieldError("actor", "is required")
	}
	if err := s.checkForm(&p.FormParams); err != nil {
		return AssignmentView{}, err
	}
	p.Comment = strings.TrimSpace(p.Comment)
	if len(p.Comment) > maxCommentLen {
		return AssignmentView{}, fieldError("comment", "is too long")
	}
	a, err := s.repo.Give(ctx, id, p.EmployeeID, func(cur Asset, open *Assignment, emp EmployeeView) (Asset, Assignment, []audit.Event, error) {
		if open != nil {
			return cur, Assignment{}, nil, ErrAlreadyGiven
		}
		if cur.Kind == KindSIM && (cur.ConnectionStatus == nil || *cur.ConnectionStatus != StatusActive) {
			status := Status("unknown")
			if cur.ConnectionStatus != nil {
				status = *cur.ConnectionStatus
			}
			return cur, Assignment{}, nil, fmt.Errorf("%w: it is %s", ErrNotActive, status)
		}
		next, err := fill(cur, p.FormParams)
		if err != nil {
			return cur, Assignment{}, nil, err
		}
		now := s.now()
		as := Assignment{
			ID: s.newID(), AssetID: cur.ID, EmployeeID: emp.ID, GivenDate: p.GivenDate, GivenByUserID: actor,
			CreatedAt: now, Comment: p.Comment, EmployeeName: emp.FullName(),
		}
		if next.NeedsForm() {
			if !p.PaperFormSigned {
				return cur, Assignment{}, nil, fieldError("paper_form_signed", "must be ticked once the employee has signed the printed form")
			}
			b, hash := formOf(next, emp, p.GivenDate).encode()
			if p.FormHash != hash {
				return cur, Assignment{}, nil, ErrFormChanged
			}
			version := FormTemplateVersion
			as.Form, as.FormTemplateVersion, as.DocumentHash, as.PaperFormSigned = b, &version, &hash, true
		} else if p.PaperFormSigned || p.FormHash != "" {
			return cur, Assignment{}, nil, fieldError("paper_form_signed", "is only for assets that need a form")
		}
		var evs []audit.Event
		if before, after := detailsChange(cur, next); len(after) > 0 {
			next.UpdatedAt, next.UpdatedByUserID = now, actor
			ev, err := s.event(actor, EventUpdated, cur.ID, now, before, after)
			if err != nil {
				return cur, Assignment{}, nil, err
			}
			evs = append(evs, ev)
		}
		ev, err := s.event(actor, EventGiven, cur.ID, now, nil, map[string]any{
			"assignment_id": as.ID, "employee_id": emp.ID, "employee_name": emp.FullName(),
			"given_date": as.GivenDate, "document_hash": as.DocumentHash,
		})
		if err != nil {
			return cur, Assignment{}, nil, err
		}
		return next, as, append(evs, ev), nil
	})
	if err != nil {
		return AssignmentView{}, err
	}
	return s.assignmentView(a), nil
}

// ReturnParams are Register SIM Return's and Register Asset Return's form.
// An empty date is today.
type ReturnParams struct {
	ReturnedDate string
	Comment      string
}

// Return registers that the asset is physically back (§11): the open
// assignment ends and the asset is in the Office. The connection status, a
// Not Returned mark, the form and the signed copy stay as they are.
func (s *Service) Return(ctx context.Context, id uuid.UUID, p ReturnParams, actor uuid.UUID) (AssignmentView, error) {
	if actor == uuid.Nil {
		return AssignmentView{}, fieldError("actor", "is required")
	}
	if p.ReturnedDate == "" {
		p.ReturnedDate = s.today()
	}
	if err := s.checkDate("returned_date", p.ReturnedDate); err != nil {
		return AssignmentView{}, err
	}
	p.Comment = strings.TrimSpace(p.Comment)
	if len(p.Comment) > maxCommentLen {
		return AssignmentView{}, fieldError("comment", "is too long")
	}
	a, err := s.repo.UpdateOpen(ctx, id, func(cur Asset, open *Assignment) (Assignment, []audit.Event, error) {
		if open == nil {
			return Assignment{}, nil, ErrNotGiven
		}
		if p.ReturnedDate < open.GivenDate {
			return Assignment{}, nil, fieldError("returned_date", "can't be before the given date")
		}
		now := s.now()
		next := *open
		next.ReturnedDate, next.ReturnedAt, next.ReturnedByUserID, next.ReturnComment = &p.ReturnedDate, &now, &actor, &p.Comment
		ev, err := s.event(actor, EventReturned, cur.ID, now, nil, map[string]any{
			"assignment_id": open.ID, "employee_id": open.EmployeeID, "employee_name": open.EmployeeName,
			"given_date": open.GivenDate, "returned_date": p.ReturnedDate,
		})
		if err != nil {
			return Assignment{}, nil, err
		}
		return next, []audit.Event{ev}, nil
	})
	if err != nil {
		return AssignmentView{}, err
	}
	return s.assignmentView(a), nil
}

// NotReturnedParams are Mark as Not Returned's form.
type NotReturnedParams struct {
	Whereabouts string
	Comment     string
}

// MarkNotReturned marks the open assignment (§13): the asset stays with its
// holder and out of office stock, and the mark is set once. A later return is
// registered as usual and the mark stays.
func (s *Service) MarkNotReturned(ctx context.Context, id uuid.UUID, p NotReturnedParams, actor uuid.UUID) (AssignmentView, error) {
	if actor == uuid.Nil {
		return AssignmentView{}, fieldError("actor", "is required")
	}
	w := Whereabouts(p.Whereabouts)
	if w != WhereaboutsWithEmployee && w != WhereaboutsUnknown {
		return AssignmentView{}, fieldError("whereabouts", "must be WITH_EMPLOYEE or UNKNOWN")
	}
	p.Comment = strings.TrimSpace(p.Comment)
	if len(p.Comment) > maxCommentLen {
		return AssignmentView{}, fieldError("comment", "is too long")
	}
	a, err := s.repo.UpdateOpen(ctx, id, func(cur Asset, open *Assignment) (Assignment, []audit.Event, error) {
		if open == nil {
			return Assignment{}, nil, ErrNotGiven
		}
		if open.NotReturnedAt != nil {
			return Assignment{}, nil, ErrAlreadyMarked
		}
		now := s.now()
		next := *open
		next.NotReturnedAt, next.NotReturnedByUserID, next.NotReturnedComment, next.Whereabouts = &now, &actor, &p.Comment, &w
		ev, err := s.event(actor, EventMarkedNotReturned, cur.ID, now, nil, map[string]any{
			"assignment_id": open.ID, "employee_id": open.EmployeeID, "employee_name": open.EmployeeName, "whereabouts": w,
		})
		if err != nil {
			return Assignment{}, nil, err
		}
		return next, []audit.Event{ev}, nil
	})
	if err != nil {
		return AssignmentView{}, err
	}
	return s.assignmentView(a), nil
}

// Form is an assignment's stored form, for reprinting; ErrNoForm when the
// asset needed none.
func (s *Service) Form(ctx context.Context, assetID, assignmentID uuid.UUID) (FormResult, error) {
	if _, err := s.repo.Get(ctx, assetID); err != nil {
		return FormResult{}, err
	}
	as, err := s.repo.Assignments(ctx, assetID)
	if err != nil {
		return FormResult{}, err
	}
	for _, a := range as {
		if a.ID != assignmentID {
			continue
		}
		if a.Form == nil || a.DocumentHash == nil {
			return FormResult{}, ErrNoForm
		}
		// The database keeps the form as JSONB, which reorders its keys: decode
		// and encode it again for the bytes that were hashed, and check them.
		var f Form
		if err := json.Unmarshal(a.Form, &f); err != nil {
			return FormResult{}, fmt.Errorf("asset: stored form of %s: %w", a.ID, err)
		}
		b, hash := f.encode()
		if hash != *a.DocumentHash {
			return FormResult{}, fmt.Errorf("asset: stored form of %s does not match its document hash", a.ID)
		}
		return FormResult{Form: b, DocumentHash: hash}, nil
	}
	return FormResult{}, ErrNotFound
}
