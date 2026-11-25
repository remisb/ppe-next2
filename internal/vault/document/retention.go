package document

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/vault"
)

// Retention (docs/specs/vault-service.md, "Retention"): each type with a time
// rule is kept for Lithuania's minimum period (vault.Types()), counted, as the
// archives' rules count it, from 1 January of the year after its rule's day,
// then shredded by the upkeep unless held. A sealed document removed by a user
// is shredded at once; one that is not sealed waits for its day.

// timedTypes are the keys of the types whose retention shreds.
func timedTypes() []string {
	var out []string
	for _, t := range vault.Types() {
		if t.Retention.Timed() {
			out = append(out, t.Key)
		}
	}
	return out
}

// retainFrom is the day retention counts from for a rule's day: 1 January of
// the next year.
func retainFrom(day string) (time.Time, error) {
	at, err := time.Parse(time.DateOnly, day)
	if err != nil {
		return time.Time{}, err
	}
	return time.Date(at.Year()+1, time.January, 1, 0, 0, 0, 0, time.UTC), nil
}

// dueDay is when the retention rule of c's type shreds it, or nil when it
// cannot be known yet (still employed, no date, the source's record still
// open) or never.
func (s *Service) dueDay(ctx context.Context, c Candidate) (*string, error) {
	t, ok := vault.TypeOf(c.Type)
	if !ok || !t.Retention.Timed() {
		return nil, nil
	}
	add := func(day string) (*string, error) {
		from, err := retainFrom(day)
		if err != nil {
			return nil, err
		}
		due := from.AddDate(0, t.Retention.Months, 0).Format(time.DateOnly)
		return &due, nil
	}
	switch t.Retention.Rule {
	case vault.AfterDocDate:
		if c.DocumentDate == nil {
			return nil, nil
		}
		return add(*c.DocumentDate)
	case vault.AfterEmploymentEnd:
		if s.employments == nil || len(c.Employees) == 0 {
			return nil, nil
		}
		last := ""
		for _, e := range c.Employees {
			ended, on, err := s.employments.EmploymentEnded(ctx, e)
			if err != nil {
				return nil, err
			}
			if !ended {
				return nil, nil
			}
			last = max(last, on)
		}
		return add(last)
	case vault.AfterSourceEnds:
		if s.records == nil || c.SourceKind == nil || c.SourceID == nil {
			return nil, nil
		}
		on, ended, err := s.records.Ended(ctx, *c.SourceKind, *c.SourceID)
		if err != nil || !ended {
			return nil, err
		}
		return add(on)
	}
	return nil, nil
}

// Shredded is what ShredDue did.
type Shredded struct {
	Documents int
	// Failed are the documents or objects that could not be shredded or deleted; the log names them.
	Failed int
}

// ShredDue applies the types' retention, for the upkeep: each document's
// retain_until is computed again, and one past it (or a sealed one removed)
// is shredded unless held (vault.document_shredded, by no one), then its
// files deleted from the store. A rule, not an action: after a restore it
// shreds again.
func (s *Service) ShredDue(ctx context.Context, logger *slog.Logger) (Shredded, error) {
	var out Shredded
	cands, err := s.repo.Retained(ctx, timedTypes())
	if err != nil {
		return out, err
	}
	today := s.today()
	for _, c := range cands {
		due, err := s.dueDay(ctx, c)
		if err != nil {
			out.Failed++
			logger.Error("vault retention failed", slog.String("document", c.ID.String()), slog.Any("error", err))
			continue
		}
		if !sameDate(due, c.RetainUntil) {
			if err := s.repo.SetRetainUntil(ctx, c.ID, due); err != nil {
				return out, err
			}
		}
		removedSealed := c.Removed && c.Sealed
		if !removedSealed && (due == nil || *due > today) {
			continue
		}
		if c.HoldUntil != nil && *c.HoldUntil >= today {
			continue
		}
		ev, err := audit.New(s.newID(), nil, EventShredded, Entity, c.ID, s.now(), nil, map[string]any{
			"type": c.Type, "number": c.Number, "document_date": c.DocumentDate, "retain_until": due, "removed": c.Removed,
		})
		if err != nil {
			return out, err
		}
		keys, err := s.repo.Shred(ctx, c.ID, s.now(), today, ev)
		if err != nil {
			out.Failed++
			logger.Error("vault shredding failed", slog.String("document", c.ID.String()), slog.Any("error", err))
			continue
		}
		out.Documents++
		if s.store == nil {
			continue
		}
		for _, k := range keys {
			if err := s.store.Delete(ctx, k); err != nil && !errors.Is(err, files.ErrNotFound) {
				out.Failed++
				logger.Error("vault shredded file not deleted", slog.String("document", c.ID.String()), slog.Any("error", err))
			}
		}
	}
	return out, nil
}

// holdable is nil when reader may set a Legal Hold on document id: one they
// see, of a type whose retention shreds, with its manage permission, or
// vault.manage for a type no one manages here (archived, sourced).
func (s *Service) holdable(ctx context.Context, reader Reader, id uuid.UUID) error {
	if reader.ID == uuid.Nil {
		return fieldError("actor", "is required")
	}
	d, err := s.Get(ctx, reader, id)
	if err != nil {
		return err
	}
	t, ok := vault.TypeOf(d.Type)
	if !ok {
		return ErrNotFound
	}
	perm := t.Manage
	if perm == "" {
		perm = vault.PermManage
	}
	if !reader.holds(perm) {
		return ErrForbidden
	}
	if !t.Retention.Timed() {
		return fmt.Errorf("%w: hold: its type is kept until removed", ErrInvalid)
	}
	return nil
}
