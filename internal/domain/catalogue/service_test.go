package catalogue

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/size"
)

type fakeRepo struct {
	mu     sync.Mutex
	rows   map[uuid.UUID]Item
	events []audit.Event
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[uuid.UUID]Item{}} }

func (f *fakeRepo) nameTaken(name string, except uuid.UUID) bool {
	for _, i := range f.rows {
		if i.ID != except && !i.Deleted() && strings.EqualFold(i.Name, name) {
			return true
		}
	}
	return false
}

func (f *fakeRepo) Create(_ context.Context, i Item, ev *audit.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.nameTaken(i.Name, i.ID) {
		return ErrNameTaken
	}
	f.rows[i.ID] = i
	if ev != nil {
		f.events = append(f.events, *ev)
	}
	return nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (Item, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	i, ok := f.rows[id]
	if !ok || i.Deleted() {
		return Item{}, ErrNotFound
	}
	return i, nil
}

func (f *fakeRepo) PriceHistory(_ context.Context, id uuid.UUID) ([]PriceEntry, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []PriceEntry{}
	for _, ev := range slices.Backward(f.events) {
		if ev.EntityID != id || (ev.Event != EventCreated && ev.Event != EventPriceChanged) {
			continue
		}
		var before, after priceSnapshot
		json.Unmarshal(ev.After, &after)
		e := PriceEntry{At: ev.OccurredAt, Event: ev.Event, UnitPriceCents: after.UnitPriceCents, ServicePeriodMonths: after.ServicePeriodMonths}
		if len(ev.Before) > 0 && json.Unmarshal(ev.Before, &before) == nil {
			e.BeforeCents, e.BeforeServiceMonths = before.UnitPriceCents, before.ServicePeriodMonths
		}
		out = append(out, e)
	}
	return out, nil
}

func (f *fakeRepo) list(activeOnly bool) []Item {
	out := make([]Item, 0)
	for _, i := range f.rows {
		if !i.Deleted() && (!activeOnly || i.Active) {
			out = append(out, i)
		}
	}
	slices.SortFunc(out, func(a, b Item) int {
		if a.DisplayRank != b.DisplayRank {
			return a.DisplayRank - b.DisplayRank
		}
		return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name))
	})
	return out
}

func (f *fakeRepo) List(context.Context) ([]Item, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.list(false), nil
}

func (f *fakeRepo) ListActive(context.Context) ([]Item, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.list(true), nil
}

func (f *fakeRepo) Update(_ context.Context, id uuid.UUID, m Mutation) (Item, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[id]
	if !ok || cur.Deleted() {
		return Item{}, ErrNotFound
	}
	next, ev, err := m(cur)
	if err != nil {
		return Item{}, err
	}
	if f.nameTaken(next.Name, id) {
		return Item{}, ErrNameTaken
	}
	f.rows[id] = next
	if ev != nil {
		f.events = append(f.events, *ev)
	}
	return next, nil
}

var testActor = uuid.New()

func newTestService() (*Service, *fakeRepo) {
	repo := newFakeRepo()
	return NewService(repo, WithClock(func() time.Time { return time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC) })), repo
}

func TestCreate(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	i, err := svc.Create(ctx, Params{Name: "Safety shoes", SizeGroup: size.GroupShoes, UnitPriceCents: i64(4999), ServicePeriodMonths: ip(12), Active: true}, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if i.Currency != CurrencyEUR || i.DisplayRank != DefaultDisplayRank || len(repo.events) != 1 || repo.events[0].Event != EventCreated {
		t.Errorf("item %+v events %+v", i, repo.events)
	}
	if _, err := svc.Create(ctx, Params{Name: "SAFETY SHOES", SizeGroup: size.GroupShoes}, testActor); !errors.Is(err, ErrNameTaken) {
		t.Errorf("duplicate name err = %v", err)
	}
}

func TestPriceChangeAudited(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	p := Params{Name: "Work jacket", SizeGroup: size.GroupClothing, UnitPriceCents: i64(3000), ServicePeriodMonths: ip(12), Active: true}
	i, _ := svc.Create(ctx, p, testActor)
	repo.events = nil

	p.Details = "Model X"
	if _, err := svc.Update(ctx, i.ID, p, testActor); err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 0 {
		t.Fatalf("details change recorded %+v", repo.events)
	}

	p.UnitPriceCents = i64(3500)
	if _, err := svc.Update(ctx, i.ID, p, testActor); err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventPriceChanged ||
		!strings.Contains(string(repo.events[0].Before), `"unit_price_cents":3000`) ||
		!strings.Contains(string(repo.events[0].After), `"unit_price_cents":3500`) {
		t.Fatalf("events = %+v", repo.events)
	}

	p.ServicePeriodMonths = ip(24)
	svc.Update(ctx, i.ID, p, testActor)
	if len(repo.events) != 2 || repo.events[1].Event != EventPriceChanged {
		t.Errorf("service period change not recorded: %+v", repo.events)
	}
}

func TestActivationAndListActive(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	mk := func(name string, rank int) Item {
		i, err := svc.Create(ctx, Params{Name: name, SizeGroup: size.GroupNone, Active: true, DisplayRank: ip(rank)}, testActor)
		if err != nil {
			t.Fatal(err)
		}
		return i
	}
	mk("Zeta", 1000)
	helmet := mk("Safety helmet", 5)
	mk("Safety shoes", 1)
	mk("Alpha", 1000)

	if _, err := svc.SetActive(ctx, helmet.ID, false, testActor); err != nil {
		t.Fatal(err)
	}
	if repo.events[len(repo.events)-1].Event != EventDeactivated {
		t.Errorf("last event = %s", repo.events[len(repo.events)-1].Event)
	}
	active, _ := svc.ListActive(ctx)
	var names []string
	for _, i := range active {
		names = append(names, i.Name)
	}
	if got := strings.Join(names, ","); got != "Safety shoes,Alpha,Zeta" {
		t.Errorf("active order = %s", got)
	}
	all, _ := svc.List(ctx)
	if len(all) != 4 {
		t.Errorf("list all = %d, want 4 incl. inactive", len(all))
	}
	if _, err := svc.SetActive(ctx, uuid.New(), true, testActor); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown item err = %v", err)
	}
}

func TestDelete(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	i, _ := svc.Create(ctx, Params{Name: "Gloves", SizeGroup: size.GroupNone}, testActor)
	if err := svc.Delete(ctx, i.ID, testActor); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, i.ID, testActor); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete err = %v", err)
	}
	if _, err := svc.Create(ctx, Params{Name: "gloves", SizeGroup: size.GroupNone}, testActor); err != nil {
		t.Errorf("name reuse after delete: %v", err)
	}
}

func TestPriceHistory(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	p := Params{Name: "Gloves", SizeGroup: size.GroupNone, UnitPriceCents: i64(200), ServicePeriodMonths: ip(1), Active: true}
	i, _ := svc.Create(ctx, p, testActor)
	p.UnitPriceCents = i64(250)
	svc.Update(ctx, i.ID, p, testActor)
	p.Details = "Nitrile" // not a price change
	svc.Update(ctx, i.ID, p, testActor)

	h, err := svc.PriceHistory(ctx, i.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(h) != 2 || h[0].Event != EventPriceChanged || *h[0].UnitPriceCents != 250 || *h[0].BeforeCents != 200 ||
		h[1].Event != EventCreated || *h[1].UnitPriceCents != 200 || h[1].BeforeCents != nil {
		t.Errorf("history = %+v", h)
	}
	if _, err := svc.PriceHistory(ctx, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown item: %v, want ErrNotFound", err)
	}
}
