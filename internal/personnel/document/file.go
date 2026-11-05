package document

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/sealbox"
)

// What a personnel file's actions are: Show Document and its copies, Add to
// Employee Record changed later, Remove, Mark Employment Ended, Legal Hold,
// and the shredding the retention rule does (docs/specs/personnel-service.md).

// Shown is what Show Document opens: the sealed fields, and which copies there are.
type Shown struct {
	Document Document `json:"document"`
	Fields   Fields   `json:"fields"`
}

// maxReasonLen is a Legal Hold reason's most characters.
const maxReasonLen = 500

// open is a document and its subject's data key, opened.
func (s *Service) open(ctx context.Context, id uuid.UUID) (Opened, *sealbox.Box, error) {
	if !s.configured() {
		return Opened{}, nil, ErrNotConfigured
	}
	o, err := s.repo.Document(ctx, id)
	if err != nil {
		return Opened{}, nil, err
	}
	box, err := s.keys.openDataKey(o.Document.EmployeeID, o.SealedKey, o.KeyID)
	if err != nil {
		return Opened{}, nil, err
	}
	return o, box, nil
}

// Show opens a document's sealed fields (FR-14). The showing is recorded
// first; nothing is answered if that fails.
func (s *Service) Show(ctx context.Context, id, actor uuid.UUID) (Shown, error) {
	o, box, err := s.open(ctx, id)
	if err != nil {
		return Shown{}, err
	}
	plain, err := box.Open(o.Sealed, documentContext(id))
	if err != nil {
		return Shown{}, ErrUnopenable
	}
	var f Fields
	if err := json.Unmarshal(plain, &f); err != nil {
		return Shown{}, ErrUnopenable
	}
	if err := s.recordShown(ctx, o.Document, "fields", actor); err != nil {
		return Shown{}, err
	}
	return Shown{Document: o.Document, Fields: f}, nil
}

// ShowCopy opens one of a document's copies, a JPEG, checked against the hash
// kept when it was saved. The showing is recorded first.
func (s *Service) ShowCopy(ctx context.Context, id uuid.UUID, side Side, actor uuid.UUID) ([]byte, error) {
	o, box, err := s.open(ctx, id)
	if err != nil {
		return nil, err
	}
	var c *Copy
	for i := range o.Copies {
		if o.Copies[i].Side == side {
			c = &o.Copies[i]
		}
	}
	if c == nil {
		return nil, ErrNotFound
	}
	r, err := s.store.Get(ctx, c.ObjectKey)
	if err != nil {
		return nil, err
	}
	sealed, err := io.ReadAll(io.LimitReader(r, maxCopySize+1024))
	r.Close()
	if err != nil {
		return nil, err
	}
	jpg, err := box.Open(sealed, copyContext(c.ID))
	if err != nil || !bytes.Equal(sha256Of(jpg), c.SHA256) {
		return nil, ErrUnopenable
	}
	if err := s.recordShown(ctx, o.Document, string(side), actor); err != nil {
		return nil, err
	}
	return jpg, nil
}

func (s *Service) recordShown(ctx context.Context, d Document, what string, actor uuid.UUID) error {
	after := summaryOf(d)
	after["shown"] = what
	ev, err := audit.New(s.newID(), &actor, EventShown, auditEntity, d.EmployeeID, s.now(), nil, after)
	if err != nil {
		return err
	}
	return s.repo.Record(ctx, []audit.Event{ev})
}

// SetEmployeeRecord changes a document's Add to Employee Record. It does not
// write the employee's fields: that takes a new scan or the employee form.
func (s *Service) SetEmployeeRecord(ctx context.Context, id uuid.UUID, on bool, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	return s.repo.UpdateDocument(ctx, id, func(cur Document) (DocumentChange, []audit.Event, error) {
		if cur.OnEmployeeRecord == on {
			return DocumentChange{OnEmployeeRecord: on}, nil, nil
		}
		before, after := summaryOf(cur), summaryOf(cur)
		before["on_employee_record"], after["on_employee_record"] = cur.OnEmployeeRecord, on
		ev, err := audit.New(s.newID(), &actor, EventUpdated, auditEntity, cur.EmployeeID, s.now(), before, after)
		return DocumentChange{OnEmployeeRecord: on}, []audit.Event{ev}, err
	})
}

// Remove removes a document and deletes its copies' objects. The sealed row
// and the objects' older versions stay openable with the person's key until
// the retention rule shreds it.
func (s *Service) Remove(ctx context.Context, id, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	var keys []string
	if s.store != nil {
		if o, err := s.repo.Document(ctx, id); err == nil {
			for _, c := range o.Copies {
				keys = append(keys, c.ObjectKey)
			}
		}
	}
	err := s.repo.UpdateDocument(ctx, id, func(cur Document) (DocumentChange, []audit.Event, error) {
		ev, err := audit.New(s.newID(), &actor, EventRemoved, auditEntity, cur.EmployeeID, s.now(), summaryOf(cur), nil)
		return DocumentChange{OnEmployeeRecord: cur.OnEmployeeRecord, Removed: true}, []audit.Event{ev}, err
	})
	if err != nil {
		return err
	}
	for _, k := range keys {
		_ = s.store.Delete(context.WithoutCancel(ctx), k)
	}
	return nil
}

// Retention is the employee's personnel file's retention; ErrNotFound when
// they have no file.
func (s *Service) Retention(ctx context.Context, employeeID uuid.UUID) (Retention, error) {
	ret, found, err := s.repo.Retention(ctx, employeeID)
	if err == nil && !found {
		err = ErrNotFound
	}
	return ret, err
}

// SetEmploymentEnded records when the person's employment ended, the date
// retention runs from (FR-20); nil clears it (the person is back).
func (s *Service) SetEmploymentEnded(ctx context.Context, employeeID uuid.UUID, on *string, actor uuid.UUID) (Retention, error) {
	if actor == uuid.Nil {
		return Retention{}, fieldError("actor", "is required")
	}
	if on != nil && !isISODate(*on) {
		return Retention{}, fieldError("employment_ended_on", "must be a date (YYYY-MM-DD)")
	}
	if on != nil && *on > s.today() {
		return Retention{}, fieldError("employment_ended_on", "is in the future")
	}
	var out Retention
	err := s.repo.UpdateSubject(ctx, employeeID, func(cur Retention) (Retention, []audit.Event, error) {
		next := cur
		next.EmploymentEndedOn = on
		out = next
		if eq(cur.EmploymentEndedOn, on) {
			return next, nil, nil
		}
		var ev audit.Event
		var err error
		if on == nil {
			ev, err = audit.New(s.newID(), &actor, EventEmploymentCleared, auditEntity, employeeID, s.now(),
				map[string]any{"employment_ended_on": cur.EmploymentEndedOn}, nil)
		} else {
			ev, err = audit.New(s.newID(), &actor, EventEmploymentEnded, auditEntity, employeeID, s.now(),
				map[string]any{"employment_ended_on": cur.EmploymentEndedOn}, map[string]any{"employment_ended_on": *on})
		}
		return next, []audit.Event{ev}, err
	})
	return out, err
}

// SetHold sets a Legal Hold, a date and a reason the shredding job respects;
// a nil until clears it.
func (s *Service) SetHold(ctx context.Context, employeeID uuid.UUID, until *string, reason string, actor uuid.UUID) (Retention, error) {
	if actor == uuid.Nil {
		return Retention{}, fieldError("actor", "is required")
	}
	reason = strings.TrimSpace(reason)
	if until != nil {
		switch {
		case !isISODate(*until):
			return Retention{}, fieldError("until", "must be a date (YYYY-MM-DD)")
		case *until <= s.today():
			return Retention{}, fieldError("until", "must be after today")
		case reason == "":
			return Retention{}, fieldError("reason", "is required")
		case len([]rune(reason)) > maxReasonLen:
			return Retention{}, fieldError("reason", "is too long")
		}
	}
	var out Retention
	err := s.repo.UpdateSubject(ctx, employeeID, func(cur Retention) (Retention, []audit.Event, error) {
		next := cur
		if until == nil {
			next.HoldUntil, next.HoldReason = nil, nil
		} else {
			next.HoldUntil, next.HoldReason = until, &reason
		}
		out = next
		if eq(cur.HoldUntil, next.HoldUntil) && eq(cur.HoldReason, next.HoldReason) {
			return next, nil, nil
		}
		before := map[string]any{"hold_until": cur.HoldUntil, "hold_reason": cur.HoldReason}
		var ev audit.Event
		var err error
		if until == nil {
			ev, err = audit.New(s.newID(), &actor, EventHoldCleared, auditEntity, employeeID, s.now(), before, nil)
		} else {
			ev, err = audit.New(s.newID(), &actor, EventHoldSet, auditEntity, employeeID, s.now(), before,
				map[string]any{"hold_until": *until, "hold_reason": reason})
		}
		return next, []audit.Event{ev}, err
	})
	return out, err
}

// ShredResult is what a shredding run did: how many personnel files went.
type ShredResult struct {
	Files  int `json:"files"`
	Failed int `json:"failed"`
}

// ShredDue applies the retention rule (D3, PR-8): every personnel file whose
// employment ended at least months ago, and that no Legal Hold keeps, is
// shredded: its data key, documents and copies go, and their objects. It is
// a rule, not an action: run again, or after a restore, it shreds again what
// the rule says is gone, and finds nothing else to do.
func (s *Service) ShredDue(ctx context.Context, months int, logger *slog.Logger) (ShredResult, error) {
	var res ShredResult
	if months < 1 {
		return res, errors.New("document: the retention period must be at least a month")
	}
	due, err := s.repo.Due(ctx, s.today(), months)
	if err != nil {
		return res, err
	}
	for _, employeeID := range due {
		keys, err := s.repo.Shred(ctx, employeeID, func(documents int) []audit.Event {
			ev, err := audit.New(s.newID(), nil, EventFileShredded, auditEntity, employeeID, s.now(), nil,
				map[string]any{"documents": documents, "retention_months": months})
			if err != nil {
				return nil
			}
			return []audit.Event{ev}
		})
		if err != nil {
			res.Failed++
			logger.Error("personnel file shredding failed", slog.String("employee", employeeID.String()), slog.Any("error", err))
			continue
		}
		res.Files++
		if s.store != nil {
			for _, k := range keys {
				if err := s.store.Delete(context.WithoutCancel(ctx), k); err != nil {
					// Unreadable without the key already; logged for the bucket's sake.
					logger.Warn("a shredded copy's object was not deleted", slog.String("object", k), slog.Any("error", err))
				}
			}
		}
	}
	return res, nil
}
