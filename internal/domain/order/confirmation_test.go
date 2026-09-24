package order

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

// orderedFixture places one ORDERED order through the fake repository and
// returns a service whose clock the test controls.
func orderedFixture(t *testing.T) (markFixture, Order, *time.Time) {
	t.Helper()
	f := newMarkFixture()
	now := time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC)
	f.svc.now = func() time.Time { return now }
	o, err := f.svc.MarkAsOrdered(context.Background(), MarkAsOrderedParams{f.emp, []LineParams{{f.shoes, 1, sp("43")}, {f.gloves, 2, nil}}}, f.actor)
	if err != nil {
		t.Fatal(err)
	}
	return f, o, &now
}

func TestReceiptIsSnapshotOnlyAndHashStable(t *testing.T) {
	_, o, _ := orderedFixture(t)
	r := ReceiptOf(o)
	if r.RecordNumber != "WE-000001" || r.EmployeeFirstName != "Jonas" || r.TotalCents != 4999+500 ||
		r.Lines[1].TotalCents != 500 || r.Lines[0].Size == nil || r.TextRU == "" || r.TextEN == "" {
		t.Errorf("receipt = %+v", r)
	}
	h := DocumentHash(r)
	if len(h) != 64 || DocumentHash(ReceiptOf(o)) != h {
		t.Errorf("hash %q not stable", h)
	}
	o.Lines[1].Quantity = 3
	if DocumentHash(ReceiptOf(o)) == h {
		t.Error("hash ignores line changes")
	}
}

func TestElectronicConfirmation(t *testing.T) {
	f, o, now := orderedFixture(t)
	ctx := context.Background()

	token, expires, err := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor)
	if err != nil {
		t.Fatal(err)
	}
	if !expires.Equal(now.Add(DefaultConfirmTTL)) || len(token) < 40 {
		t.Errorf("token %q expires %v", token, expires)
	}
	if stored := f.repo.links[0]; stored.TokenHash == nil || *stored.TokenHash == token {
		t.Fatal("token stored in plaintext")
	}

	view, err := f.svc.RecordByToken(ctx, token)
	if err != nil || view.Order.Status != StatusOrdered || view.Confirmation != nil {
		t.Fatalf("view = %+v, %v", view, err)
	}
	if _, err := f.svc.ConfirmByToken(ctx, token, false); !errors.Is(err, ErrInvalid) {
		t.Errorf("unchecked box err = %v", err)
	}

	rec, err := f.svc.ConfirmByToken(ctx, token, true)
	if err != nil {
		t.Fatal(err)
	}
	c := rec.Confirmation
	if rec.Order.Status != StatusGiven || *rec.Order.ConfirmationMethod != MethodElectronic || *rec.Order.GivenByName != "Admin" ||
		c == nil || *c.ConfirmedName != "Jonas Petraitis" || *c.DocumentHash != DocumentHash(ReceiptOf(o)) || rec.DocumentHash != *c.DocumentHash {
		t.Fatalf("record = %+v confirmation %+v", rec.Order, c)
	}
	events := len(f.repo.events)

	// Second confirmation: the same record, nothing written.
	again, err := f.svc.ConfirmByToken(ctx, token, true)
	if err != nil || again.Order.Status != StatusGiven || !again.Order.GivenAt.Equal(*rec.Order.GivenAt) || len(f.repo.events) != events {
		t.Errorf("second confirm = %+v, %v, events %d→%d", again.Order, err, events, len(f.repo.events))
	}
	if _, _, err := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor); !errors.Is(err, ErrNotOrdered) {
		t.Errorf("link for GIVEN order err = %v", err)
	}
	if _, err := f.svc.RecordByToken(ctx, token); err != nil {
		t.Errorf("used link should show the record: %v", err)
	}
}

func TestLinkExpiryAndReplacement(t *testing.T) {
	f, o, now := orderedFixture(t)
	ctx := context.Background()
	first, _, _ := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor)
	second, _, _ := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor)

	if _, err := f.svc.ConfirmByToken(ctx, first, true); !errors.Is(err, ErrLinkExpired) {
		t.Errorf("replaced link err = %v", err)
	}
	if _, err := f.svc.RecordByToken(ctx, first); !errors.Is(err, ErrLinkExpired) {
		t.Errorf("replaced link view err = %v", err)
	}
	if _, err := f.svc.ConfirmByToken(ctx, "no-such-token", true); !errors.Is(err, ErrLinkExpired) {
		t.Errorf("unknown link err = %v", err)
	}
	*now = now.Add(DefaultConfirmTTL + time.Minute)
	if _, err := f.svc.ConfirmByToken(ctx, second, true); !errors.Is(err, ErrLinkExpired) {
		t.Errorf("expired link err = %v", err)
	}
	if f.repo.orders[o.ID].Status != StatusOrdered {
		t.Error("expired link changed the order")
	}
}

func TestPaperConfirmation(t *testing.T) {
	f, o, _ := orderedFixture(t)
	ctx := context.Background()
	token, _, _ := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor)

	rec, err := f.svc.ConfirmPaper(ctx, o.ID, f.actor)
	if err != nil {
		t.Fatal(err)
	}
	if *rec.Order.ConfirmationMethod != MethodPaper || rec.Confirmation.Method != MethodPaper || rec.Confirmation.TokenHash != nil {
		t.Errorf("paper record = %+v", rec)
	}
	// The outstanding link was revoked, but it now shows the final record,
	// and confirming through it is a no-op.
	if again, err := f.svc.ConfirmByToken(ctx, token, true); err != nil || *again.Order.ConfirmationMethod != MethodPaper {
		t.Errorf("link after paper = %+v, %v", again.Order, err)
	}
	if again, err := f.svc.ConfirmPaper(ctx, o.ID, f.actor); err != nil || !again.Order.GivenAt.Equal(*rec.Order.GivenAt) {
		t.Errorf("second paper confirm = %v", err)
	}
	if _, err := f.svc.ConfirmPaper(ctx, uuid.New(), f.actor); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown order err = %v", err)
	}
}
