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
// inventory number (the import numbers it), its status, the employee who
// already holds it, if anyone, and its PIN and PUK, when known (Scan SIMs).
type ImportSIM struct {
	Params
	Status   Status
	HolderID *uuid.UUID
	Codes    *SIMCodes
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
// asset.registered event, its sealed PIN and PUK, if any, and, when someone
// holds it, the open assignment and its asset.given event.
type Imported struct {
	Asset      Asset
	Bump       *Bump
	Registered audit.Event
	Codes      *SealedCodes
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
func (e *ImportRowError) RowIndex() int { return e.Index }

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
	items, sims, err := s.registerSIMs(ctx, p.SIMs, p.Comment, actor)
	if err != nil {
		return ImportResult{}, err
	}
	if err := s.writeSIMs(ctx, items, p.Commit); err != nil {
		return ImportResult{}, err
	}
	return ImportResult{SIMs: sims, Committed: p.Commit}, nil
}

// registerSIMs builds what ImportSIMs and AddSIMs write: each card numbered on
// from the SIM counter, checked as Add SIM checks it, its codes sealed, and,
// for a held one, its assignment with comment. Nothing is written yet.
func (s *Service) registerSIMs(ctx context.Context, list []ImportSIM, comment string, actor uuid.UUID) ([]Imported, []ImportedSIM, error) {
	last, err := s.repo.LastNumber(ctx, PrefixSIM)
	if err != nil {
		return nil, nil, err
	}
	seen := map[string]int{}
	holders := map[uuid.UUID]EmployeeView{}
	items := make([]Imported, len(list))
	out := make([]ImportedSIM, len(list))
	for i, sim := range list {
		rowErr := func(err error) error { return &ImportRowError{Index: i, Err: err} }
		if sim.InventoryNo != "" {
			return nil, nil, rowErr(fieldError("inventory_no", "is given by the import"))
		}
		sim.InventoryNo = FormatNumber(PrefixSIM, last+int64(i)+1)
		status := sim.Status
		a, err := s.newAsset(CreateParams{Params: sim.Params, Kind: KindSIM, ConnectionStatus: &status}, actor)
		if err != nil {
			return nil, nil, rowErr(err)
		}
		if j, ok := seen[simKey(*a.SimNo)]; ok {
			return nil, nil, rowErr(fmt.Errorf("%w: sim_no is also on SIM card %d of the import", ErrSIMNoTaken, j+1))
		}
		seen[simKey(*a.SimNo)] = i
		f := facts(a)
		if sim.Codes != nil {
			sealed, err := s.seal(a.ID, *sim.Codes, actor, a.CreatedAt)
			if err != nil {
				return nil, nil, err
			}
			items[i].Codes = &sealed
			f["sim_codes"] = "set"
		}
		reg, err := s.event(actor, EventRegistered, a.ID, a.CreatedAt, nil, f)
		if err != nil {
			return nil, nil, err
		}
		items[i].Asset, items[i].Bump, items[i].Registered = a, BumpOf(a), reg
		out[i] = ImportedSIM{ID: a.ID, InventoryNo: a.InventoryNo, SimNo: *a.SimNo, Status: *a.ConnectionStatus}
		if sim.HolderID == nil {
			continue
		}
		emp, ok := holders[*sim.HolderID]
		if !ok {
			if emp, err = s.repo.Employee(ctx, *sim.HolderID); err != nil {
				return nil, nil, rowErr(err)
			}
			holders[emp.ID] = emp
		}
		as := Assignment{
			ID: s.newID(), AssetID: a.ID, EmployeeID: emp.ID, GivenDate: *a.ReceivedDate, GivenByUserID: actor,
			CreatedAt: a.CreatedAt, Comment: comment, EmployeeName: emp.FullName(),
		}
		given, err := s.event(actor, EventGiven, a.ID, a.CreatedAt, nil, map[string]any{
			"assignment_id": as.ID, "employee_id": emp.ID, "employee_name": emp.FullName(),
			"given_date": as.GivenDate, "document_hash": nil,
		})
		if err != nil {
			return nil, nil, err
		}
		items[i].Assignment, items[i].Given = &as, &given
		out[i].Holder = emp.FullName()
	}
	return items, out, nil
}

// writeSIMs writes items all or none, kept when commit is set; a card the
// database refuses keeps its index, and a duplicate names the card it
// duplicates.
func (s *Service) writeSIMs(ctx context.Context, items []Imported, commit bool) error {
	if err := s.repo.ImportSIMs(ctx, items, commit); err != nil {
		var row *ImportRowError
		if errors.As(err, &row) {
			return &ImportRowError{Index: row.Index, Err: s.duplicate(ctx, row.Err, items[row.Index].Asset)}
		}
		return err
	}
	return nil
}
