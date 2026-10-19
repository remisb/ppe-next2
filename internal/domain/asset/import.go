package asset

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// ImportSIM is one SIM card of an import: Add SIM's details without an
// inventory number (the import numbers it), its status, and the employee who
// already holds it, if anyone.
type ImportSIM struct {
	Params
	Status   Status
	HolderID *uuid.UUID
}

// ImportParams are SIM cards the company had before the app, from its SIM
// card list. Comment goes on each imported assignment, saying why it has no
// form. Without Commit the import is checked in full, the database's own
// checks included, and nothing is kept.
type ImportParams struct {
	SIMs    []ImportSIM
	Comment string
	Commit  bool
}

// Imported is one SIM card as the import writes it: the asset, its
// asset.registered event, and, when someone holds it, the open assignment
// and its asset.given event.
type Imported struct {
	Asset      Asset
	Bump       *Bump
	Registered audit.Event
	Assignment *Assignment
	Given      *audit.Event
}

// ImportResult is what the import wrote, or would write without Commit.
type ImportResult struct {
	SIMs      []ImportedSIM
	Committed bool
}

// ImportedSIM is one imported card as a report lists it.
type ImportedSIM struct {
	ID          uuid.UUID
	InventoryNo string
	SimNo       string
	Status      Status
	Holder      string // the employee's name, or ""
}

// ImportRowError is a SIM card the import refused, by its index in
// ImportParams.SIMs; the import then writes nothing.
type ImportRowError struct {
	Index int
	Err   error
}

func (e *ImportRowError) Error() string { return e.Err.Error() }
func (e *ImportRowError) Unwrap() error { return e.Err }

// ImportSIMs registers SIM cards that were in use before the app, all or
// none, in one transaction: each numbered on from the SIM counter, received
// today, in its status (Blocked included, holder or not). A card someone
// holds gets an open assignment given today with no form, since none was
// signed in the app; Return and Give SIM later print one. Each card records
// asset.registered, and a held one asset.given, as Add SIM and Give SIM do.
func (s *Service) ImportSIMs(ctx context.Context, p ImportParams, actor uuid.UUID) (ImportResult, error) {
	if actor == uuid.Nil {
		return ImportResult{}, fieldError("actor", "is required")
	}
	p.Comment = strings.TrimSpace(p.Comment)
	if len(p.Comment) > maxCommentLen {
		return ImportResult{}, fieldError("comment", "is too long")
	}
	if len(p.SIMs) == 0 {
		return ImportResult{}, fieldError("sims", "are required")
	}
	last, err := s.repo.LastNumber(ctx, PrefixSIM)
	if err != nil {
		return ImportResult{}, err
	}
	seen := map[string]int{}
	holders := map[uuid.UUID]EmployeeView{}
	items := make([]Imported, len(p.SIMs))
	out := ImportResult{SIMs: make([]ImportedSIM, len(p.SIMs)), Committed: p.Commit}
	for i, sim := range p.SIMs {
		rowErr := func(err error) error { return &ImportRowError{Index: i, Err: err} }
		if sim.InventoryNo != "" {
			return ImportResult{}, rowErr(fieldError("inventory_no", "is given by the import"))
		}
		sim.InventoryNo = FormatNumber(PrefixSIM, last+int64(i)+1)
		status := sim.Status
		a, err := s.newAsset(CreateParams{Params: sim.Params, Kind: KindSIM, ConnectionStatus: &status}, actor)
		if err != nil {
			return ImportResult{}, rowErr(err)
		}
		if j, ok := seen[compactSIM(*a.SimNo)]; ok {
			return ImportResult{}, rowErr(fmt.Errorf("%w: sim_no is also on SIM card %d of the import", ErrSIMNoTaken, j+1))
		}
		seen[compactSIM(*a.SimNo)] = i
		reg, err := s.event(actor, EventRegistered, a.ID, a.CreatedAt, nil, facts(a))
		if err != nil {
			return ImportResult{}, err
		}
		items[i] = Imported{Asset: a, Bump: BumpOf(a), Registered: reg}
		out.SIMs[i] = ImportedSIM{ID: a.ID, InventoryNo: a.InventoryNo, SimNo: *a.SimNo, Status: *a.ConnectionStatus}
		if sim.HolderID == nil {
			continue
		}
		emp, ok := holders[*sim.HolderID]
		if !ok {
			if emp, err = s.repo.Employee(ctx, *sim.HolderID); err != nil {
				return ImportResult{}, rowErr(err)
			}
			holders[emp.ID] = emp
		}
		as := Assignment{
			ID: s.newID(), AssetID: a.ID, EmployeeID: emp.ID, GivenDate: *a.ReceivedDate, GivenByUserID: actor,
			CreatedAt: a.CreatedAt, Comment: p.Comment, EmployeeName: emp.FullName(),
		}
		given, err := s.event(actor, EventGiven, a.ID, a.CreatedAt, nil, map[string]any{
			"assignment_id": as.ID, "employee_id": emp.ID, "employee_name": emp.FullName(),
			"given_date": as.GivenDate, "document_hash": nil,
		})
		if err != nil {
			return ImportResult{}, err
		}
		items[i].Assignment, items[i].Given = &as, &given
		out.SIMs[i].Holder = emp.FullName()
	}
	if err := s.repo.ImportSIMs(ctx, items, p.Commit); err != nil {
		var row *ImportRowError
		if errors.As(err, &row) {
			return ImportResult{}, &ImportRowError{Index: row.Index, Err: s.duplicate(ctx, row.Err, items[row.Index].Asset)}
		}
		return ImportResult{}, err
	}
	return out, nil
}
