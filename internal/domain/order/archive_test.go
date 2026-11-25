package order

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

func (f *fakeRepo) GivenSince(_ context.Context, since time.Time) ([]uuid.UUID, error) {
	out := []uuid.UUID{}
	for id, o := range f.orders {
		if o.Status == StatusGiven && o.GivenAt != nil && !o.GivenAt.Before(since) {
			out = append(out, id)
		}
	}
	return out, nil
}

// archived records what the archiver was told.
type archived struct{ ids []uuid.UUID }

func (a *archived) RecordGiven(_ context.Context, id uuid.UUID) { a.ids = append(a.ids, id) }

// Each way of giving tells the archiver once, when the order becomes GIVEN; a
// repeated confirmation, which writes nothing, tells it nothing.
func TestConfirmationArchivesTheRecord(t *testing.T) {
	ctx := context.Background()
	for _, method := range []Method{MethodElectronic, MethodPaper, MethodInPerson} {
		t.Run(string(method), func(t *testing.T) {
			f, o, now := orderedFixture(t)
			arch := &archived{}
			WithArchiver(arch)(f.svc)
			confirm := func() error {
				switch method {
				case MethodPaper:
					_, err := f.svc.ConfirmPaper(ctx, o.ID, f.actor)
					return err
				case MethodInPerson:
					_, err := f.svc.ConfirmInPerson(ctx, o.ID, f.actor, true)
					return err
				}
				token, _, err := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor)
				if err != nil {
					return err
				}
				_, err = f.svc.ConfirmByToken(ctx, token, true)
				return err
			}
			if err := confirm(); err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(arch.ids, []uuid.UUID{o.ID}) {
				t.Fatalf("archiver told %v, want %s", arch.ids, o.ID)
			}
			if _, err := f.svc.ConfirmPaper(ctx, o.ID, f.actor); err != nil {
				t.Fatal(err)
			}
			if len(arch.ids) != 1 {
				t.Errorf("a repeated confirmation told the archiver again: %v", arch.ids)
			}
			ids, err := f.svc.GivenSince(ctx, now.Add(-time.Minute))
			if err != nil || !slices.Equal(ids, []uuid.UUID{o.ID}) {
				t.Errorf("given since = %v, %v", ids, err)
			}
		})
	}
}

// A link that fails tells the archiver nothing.
func TestRefusedConfirmationArchivesNothing(t *testing.T) {
	f, o, now := orderedFixture(t)
	arch := &archived{}
	WithArchiver(arch)(f.svc)
	ctx := context.Background()
	token, _, _ := f.svc.CreateConfirmationLink(ctx, o.ID, f.actor)
	*now = now.Add(DefaultConfirmTTL + time.Hour)
	if _, err := f.svc.ConfirmByToken(ctx, token, true); err == nil {
		t.Fatal("an expired link confirmed")
	}
	if len(arch.ids) != 0 {
		t.Errorf("archiver told %v", arch.ids)
	}
}
