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
	mu       sync.Mutex
	rows     map[uuid.UUID]Item
	pictures map[Icon]Picture
	events   []audit.Event
}

// newFakeRepo has migration 0036's pictures: shoes, the four clothes, and no size for the rest.
func newFakeRepo() *fakeRepo {
	f := &fakeRepo{rows: map[uuid.UUID]Item{}, pictures: map[Icon]Picture{}}
	for _, icon := range Icons {
		g := size.GroupNone
		switch icon {
		case IconShoes:
			g = size.GroupShoes
		case IconJacket, IconInsulatedJacket, IconTrousers, IconVest:
			g = size.GroupClothing
		}
		f.pictures[icon] = Picture{ID: uuid.New(), Icon: icon, SizeGroup: g}
	}
	return f
}

// withGroup is i as the database reads it: with its picture's size group.
func (f *fakeRepo) withGroup(i Item) Item {
	i.SizeGroup = f.pictures[i.Icon].SizeGroup
	return i
}

func (f *fakeRepo) nameTaken(name string, except uuid.UUID) bool {
	for _, i := range f.rows {
		if i.ID != except && !i.Deleted() && strings.EqualFold(i.Name, name) {
			return true
		}
	}
	return false
}

func (f *fakeRepo) Create(_ context.Context, i Item, ev *audit.Event) (Item, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.nameTaken(i.Name, i.ID) {
		return Item{}, ErrNameTaken
	}
	f.rows[i.ID] = i
	if ev != nil {
		f.events = append(f.events, *ev)
	}
	return f.withGroup(i), nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (Item, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	i, ok := f.rows[id]
	if !ok || i.Deleted() {
		return Item{}, ErrNotFound
	}
	return f.withGroup(i), nil
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
		e := PriceEntry{At: ev.OccurredAt, Event: ev.Event, PurchasePriceCents: after.PurchasePriceCents,
			AccountingPriceCents: after.AccountingPriceCents, ServicePeriodMonths: after.ServicePeriodMonths}
		if len(ev.Before) > 0 && json.Unmarshal(ev.Before, &before) == nil {
			e.BeforePurchaseCents, e.BeforeAccountingCents = before.PurchasePriceCents, before.AccountingPriceCents
			e.BeforeServiceMonths = before.ServicePeriodMonths
		}
		out = append(out, e)
	}
	return out, nil
}

func (f *fakeRepo) list(activeOnly bool) []Item {
	out := make([]Item, 0)
	for _, i := range f.rows {
		if !i.Deleted() && (!activeOnly || i.Active) {
			out = append(out, f.withGroup(i))
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
	next, evs, err := m(f.withGroup(cur))
	if err != nil {
		return Item{}, err
	}
	if f.nameTaken(next.Name, id) {
		return Item{}, ErrNameTaken
	}
	f.rows[id] = next
	f.events = append(f.events, evs...)
	return f.withGroup(next), nil
}

func (f *fakeRepo) Reorder(_ context.Context, m OrderMutation) ([]Item, error) {
	f.mu.Lock()
	cur := f.list(false)
	f.mu.Unlock()
	changed, evs, err := m(cur)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	for _, i := range changed {
		f.rows[i.ID] = i
	}
	f.events = append(f.events, evs...)
	f.mu.Unlock()
	return f.List(context.Background())
}

func (f *fakeRepo) Pictures(context.Context) ([]Picture, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Picture, 0, len(Icons))
	for _, icon := range Icons {
		p := f.pictures[icon]
		for _, i := range f.rows {
			if i.Icon == icon && !i.Deleted() {
				p.ItemCount++
			}
		}
		out = append(out, p)
	}
	return out, nil
}

func (f *fakeRepo) UpdatePicture(_ context.Context, icon Icon, m PictureMutation) (Picture, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.pictures[icon]
	if !ok {
		return Picture{}, ErrPictureNotFound
	}
	next, evs, err := m(cur)
	if err != nil {
		return Picture{}, err
	}
	f.pictures[icon] = next
	f.events = append(f.events, evs...)
	return next, nil
}

var testActor = uuid.New()

// all may change everything, prices included.
var all = Rights{Prices: true}

func newTestService() (*Service, *fakeRepo) {
	repo := newFakeRepo()
	return NewService(repo, WithClock(func() time.Time { return time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC) })), repo
}

func TestCreate(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	i, err := svc.Create(ctx, Params{Name: "Safety shoes", AccountingPriceCents: i64(4999), ServicePeriodMonths: ip(12), Active: true}, all, testActor)
	if err != nil {
		t.Fatal(err)
	}
	if i.Currency != CurrencyEUR || i.DisplayRank != DefaultDisplayRank || len(repo.events) != 1 || repo.events[0].Event != EventCreated {
		t.Errorf("item %+v events %+v", i, repo.events)
	}
	if _, err := svc.Create(ctx, Params{Name: "SAFETY SHOES"}, all, testActor); !errors.Is(err, ErrNameTaken) {
		t.Errorf("duplicate name err = %v", err)
	}
}

// An item's pictogram defaults to "other", is normalised, and must be one the app draws.
func TestIcon(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	i, err := svc.Create(ctx, Params{Name: "Ear plugs"}, all, testActor)
	if err != nil || i.Icon != IconOther {
		t.Fatalf("default icon %q, err %v", i.Icon, err)
	}
	u, err := svc.Update(ctx, i.ID, Params{Name: "Ear plugs", Icon: " Ear "}, all, testActor)
	if err != nil || u.Icon != IconEar {
		t.Fatalf("updated icon %q, err %v", u.Icon, err)
	}
	for _, icon := range []Icon{IconWeldingHelmet, IconInsulatedJacket} {
		if w, err := svc.Create(ctx, Params{Name: "Item " + string(icon), Icon: icon}, all, testActor); err != nil || w.Icon != icon {
			t.Errorf("icon %q: got %q, err %v", icon, w.Icon, err)
		}
	}
	if _, err := svc.Create(ctx, Params{Name: "Boots", Icon: "boot"}, all, testActor); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown icon err = %v", err)
	}
}

func TestPriceChangeAudited(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	p := Params{Name: "Work jacket", AccountingPriceCents: i64(3000), ServicePeriodMonths: ip(12), Active: true}
	i, _ := svc.Create(ctx, p, all, testActor)
	repo.events = nil

	p.Details = "Model X"
	if _, err := svc.Update(ctx, i.ID, p, all, testActor); err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventUpdated ||
		string(repo.events[0].Before) != `{"details":""}` || string(repo.events[0].After) != `{"details":"Model X"}` {
		t.Fatalf("details change recorded %+v, want only catalogue.updated", repo.events)
	}
	repo.events = nil

	p.AccountingPriceCents = i64(3500)
	if _, err := svc.Update(ctx, i.ID, p, all, testActor); err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventPriceChanged ||
		!strings.Contains(string(repo.events[0].Before), `"accounting_price_cents":3000`) ||
		!strings.Contains(string(repo.events[0].After), `"accounting_price_cents":3500`) {
		t.Fatalf("events = %+v", repo.events)
	}

	p.ServicePeriodMonths = ip(24)
	svc.Update(ctx, i.ID, p, all, testActor)
	if len(repo.events) != 2 || repo.events[1].Event != EventPriceChanged {
		t.Errorf("service period change not recorded: %+v", repo.events)
	}

	// The purchase price is a price too: setting it alone records a change.
	p.PurchasePriceCents = i64(2100)
	svc.Update(ctx, i.ID, p, all, testActor)
	if len(repo.events) != 3 || repo.events[2].Event != EventPriceChanged ||
		!strings.Contains(string(repo.events[2].Before), `"purchase_price_cents":null`) ||
		!strings.Contains(string(repo.events[2].After), `"purchase_price_cents":2100`) ||
		!strings.Contains(string(repo.events[2].After), `"accounting_price_cents":3500`) {
		t.Errorf("purchase price change: %+v", repo.events)
	}
}

// Without Rights.Prices an item is added without prices and edited with its
// prices as they are; the service period is not a price.
func TestPricesNeedRights(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	if _, err := svc.Create(ctx, Params{Name: "Gloves", AccountingPriceCents: i64(500)}, Rights{}, testActor); !errors.Is(err, ErrNotPermitted) {
		t.Errorf("create with a price: err = %v, want ErrNotPermitted", err)
	}
	if _, err := svc.Create(ctx, Params{Name: "Gloves", PurchasePriceCents: i64(300)}, Rights{}, testActor); !errors.Is(err, ErrNotPermitted) {
		t.Errorf("create with a purchase price: err = %v, want ErrNotPermitted", err)
	}
	p := Params{Name: "Gloves", AccountingPriceCents: i64(500), ServicePeriodMonths: ip(6), Active: true}
	i, err := svc.Create(ctx, p, all, testActor)
	if err != nil {
		t.Fatal(err)
	}

	p.Details, p.ServicePeriodMonths = "Nitrile", ip(12)
	if _, err := svc.Update(ctx, i.ID, p, Rights{}, testActor); err != nil {
		t.Errorf("edit keeping the prices: %v", err)
	}
	for name, change := range map[string]func(*Params){
		"price":          func(p *Params) { p.AccountingPriceCents = i64(600) },
		"price removed":  func(p *Params) { p.AccountingPriceCents = nil },
		"purchase price": func(p *Params) { p.PurchasePriceCents = i64(300) },
	} {
		q := p
		change(&q)
		repo.events = nil
		if _, err := svc.Update(ctx, i.ID, q, Rights{}, testActor); !errors.Is(err, ErrNotPermitted) || len(repo.events) != 0 {
			t.Errorf("%s changed without the right: err = %v, events %d", name, err, len(repo.events))
		}
	}
	if got, _ := svc.Get(ctx, i.ID); *got.AccountingPriceCents != 500 || got.PurchasePriceCents != nil {
		t.Errorf("prices = %v, %v; want unchanged", *got.AccountingPriceCents, got.PurchasePriceCents)
	}
}

func TestActivationAndListActive(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	mk := func(name string, rank int) Item {
		i, err := svc.Create(ctx, Params{Name: name, Active: true, DisplayRank: ip(rank)}, all, testActor)
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
	i, _ := svc.Create(ctx, Params{Name: "Gloves"}, all, testActor)
	if err := svc.Delete(ctx, i.ID, testActor); err != nil {
		t.Fatal(err)
	}
	if err := svc.Delete(ctx, i.ID, testActor); !errors.Is(err, ErrNotFound) {
		t.Errorf("second delete err = %v", err)
	}
	if _, err := svc.Create(ctx, Params{Name: "gloves"}, all, testActor); err != nil {
		t.Errorf("name reuse after delete: %v", err)
	}
}

func TestPriceHistory(t *testing.T) {
	svc, _ := newTestService()
	ctx := context.Background()
	p := Params{Name: "Gloves", AccountingPriceCents: i64(200), ServicePeriodMonths: ip(1), Active: true}
	i, _ := svc.Create(ctx, p, all, testActor)
	p.AccountingPriceCents = i64(250)
	svc.Update(ctx, i.ID, p, all, testActor)
	p.PurchasePriceCents = i64(180)
	svc.Update(ctx, i.ID, p, all, testActor)
	p.Details = "Nitrile" // not a price change
	svc.Update(ctx, i.ID, p, all, testActor)

	h, err := svc.PriceHistory(ctx, i.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(h) != 3 || h[0].Event != EventPriceChanged || *h[0].PurchasePriceCents != 180 || h[0].BeforePurchaseCents != nil ||
		*h[0].AccountingPriceCents != 250 || *h[0].BeforeAccountingCents != 250 ||
		h[1].Event != EventPriceChanged || *h[1].AccountingPriceCents != 250 || *h[1].BeforeAccountingCents != 200 ||
		h[2].Event != EventCreated || *h[2].AccountingPriceCents != 200 || h[2].BeforeAccountingCents != nil {
		t.Errorf("history = %+v", h)
	}
	if _, err := svc.PriceHistory(ctx, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown item: %v, want ErrNotFound", err)
	}
}

func TestOneSaveRecordsEachKindOfChange(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	p := Params{Name: "Work jacket", AccountingPriceCents: i64(3000), ServicePeriodMonths: ip(12), Active: true}
	i, _ := svc.Create(ctx, p, all, testActor)
	repo.events = nil

	p.Name, p.AccountingPriceCents, p.Active = "Winter jacket", i64(4200), false
	if _, err := svc.Update(ctx, i.ID, p, all, testActor); err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, ev := range repo.events {
		got = append(got, ev.Event)
	}
	if strings.Join(got, ",") != "catalogue.price_changed,catalogue.deactivated,catalogue.updated" {
		t.Fatalf("events = %v", got)
	}
	if string(repo.events[2].After) != `{"name":"Winter jacket"}` {
		t.Errorf("updated after = %s", repo.events[2].After)
	}
}

// An item's size group is its picture's: set by the picture it is created
// with, changed with its picture, and recorded beside a new picture.
func TestSizeGroupFromPicture(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	shoes, err := svc.Create(ctx, Params{Name: "Safety shoes", Icon: IconShoes, Active: true}, all, testActor)
	if err != nil || shoes.SizeGroup != size.GroupShoes {
		t.Fatalf("created size group %q, err %v", shoes.SizeGroup, err)
	}
	other, _ := svc.Create(ctx, Params{Name: "Ear plugs", Active: true}, all, testActor)
	if other.SizeGroup != size.GroupNone {
		t.Errorf("default picture's size group = %q", other.SizeGroup)
	}
	repo.events = nil

	u, err := svc.Update(ctx, other.ID, Params{Name: "Ear plugs", Icon: IconVest, Active: true}, all, testActor)
	if err != nil || u.SizeGroup != size.GroupClothing {
		t.Fatalf("new picture's size group %q, err %v", u.SizeGroup, err)
	}
	if len(repo.events) != 1 || string(repo.events[0].Before) != `{"icon":"other","size_group":"NONE"}` ||
		string(repo.events[0].After) != `{"icon":"vest","size_group":"CLOTHING"}` {
		t.Errorf("picture change recorded %+v", repo.events)
	}
	repo.events = nil
	// Another picture with the same size group records the picture alone.
	if _, err := svc.Update(ctx, other.ID, Params{Name: "Ear plugs", Icon: IconJacket, Active: true}, all, testActor); err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 1 || string(repo.events[0].After) != `{"icon":"jacket"}` {
		t.Errorf("same-group picture change recorded %+v", repo.events)
	}
}

func TestUpdatePicture(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	gloves, _ := svc.Create(ctx, Params{Name: "Gloves", Icon: IconGloves, Active: true}, all, testActor)
	svc.Create(ctx, Params{Name: "Winter gloves", Icon: IconGloves, Active: true}, all, testActor)
	repo.events = nil

	p, err := svc.UpdatePicture(ctx, " Gloves ", PictureParams{SizeGroup: "clothing"}, testActor)
	if err != nil || p.SizeGroup != size.GroupClothing {
		t.Fatalf("picture %+v, err %v", p, err)
	}
	if got, _ := svc.Get(ctx, gloves.ID); got.SizeGroup != size.GroupClothing {
		t.Errorf("the picture's item has size group %q", got.SizeGroup)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventPictureChanged || repo.events[0].EntityType != PictureEntity ||
		repo.events[0].EntityID != p.ID || string(repo.events[0].Before) != `{"icon":"gloves","size_group":"NONE"}` ||
		string(repo.events[0].After) != `{"icon":"gloves","size_group":"CLOTHING"}` {
		t.Errorf("events = %+v", repo.events)
	}
	// Saving the size group it has records nothing.
	if _, err := svc.UpdatePicture(ctx, IconGloves, PictureParams{SizeGroup: size.GroupClothing}, testActor); err != nil || len(repo.events) != 1 {
		t.Errorf("unchanged save: err %v, events %d", err, len(repo.events))
	}
	pics, _ := svc.Pictures(ctx)
	if len(pics) != len(Icons) || pics[0].Icon != IconShoes || pics[5].Icon != IconGloves || pics[5].ItemCount != 2 {
		t.Errorf("pictures = %+v", pics)
	}
	for name, err := range map[string]error{
		"unknown picture": func() error {
			_, err := svc.UpdatePicture(ctx, "boot", PictureParams{SizeGroup: size.GroupNone}, testActor)
			return err
		}(),
		"unknown size group": func() error {
			_, err := svc.UpdatePicture(ctx, IconGloves, PictureParams{SizeGroup: "GLOVES"}, testActor)
			return err
		}(),
		"no actor": func() error {
			_, err := svc.UpdatePicture(ctx, IconGloves, PictureParams{SizeGroup: size.GroupNone}, uuid.Nil)
			return err
		}(),
	} {
		want := ErrInvalid
		if name == "unknown picture" {
			want = ErrPictureNotFound
		}
		if !errors.Is(err, want) {
			t.Errorf("%s: err = %v, want %v", name, err, want)
		}
	}
}

func names(items []Item) string {
	var out []string
	for _, i := range items {
		out = append(out, i.Name)
	}
	return strings.Join(out, ",")
}

// Move changes only the moved item's display rank when its neighbours leave
// room, else numbers every item again; each changed rank is an event.
func TestMove(t *testing.T) {
	svc, repo := newTestService()
	ctx := context.Background()
	mk := func(name string, rank int) Item {
		i, err := svc.Create(ctx, Params{Name: name, Active: true, DisplayRank: ip(rank)}, all, testActor)
		if err != nil {
			t.Fatal(err)
		}
		return i
	}
	a, b, c := mk("A", 10), mk("B", 20), mk("C", 30)
	repo.events = nil

	// C in front of B: only C changes, to 15, one event.
	got, err := svc.Move(ctx, c.ID, &b.ID, testActor)
	if err != nil || names(got) != "A,C,B" {
		t.Fatalf("order %s, err %v", names(got), err)
	}
	if r, _ := svc.Get(ctx, c.ID); r.DisplayRank != 15 || len(repo.events) != 1 ||
		string(repo.events[0].Before) != `{"display_rank":30}` || string(repo.events[0].After) != `{"display_rank":15}` {
		t.Errorf("rank %d, events %+v", r.DisplayRank, repo.events)
	}
	// A last (no before): after B, 30.
	got, _ = svc.Move(ctx, a.ID, nil, testActor)
	if names(got) != "C,B,A" {
		t.Errorf("order %s", names(got))
	}
	// A first: below C's 15.
	got, _ = svc.Move(ctx, a.ID, &c.ID, testActor)
	if r, _ := svc.Get(ctx, a.ID); names(got) != "A,C,B" || r.DisplayRank != 5 {
		t.Errorf("order %s, A's rank %d", names(got), r.DisplayRank)
	}
	// Moving an item to where it is changes nothing.
	repo.events = nil
	if got, _ := svc.Move(ctx, c.ID, &b.ID, testActor); names(got) != "A,C,B" || len(repo.events) != 0 {
		t.Errorf("order %s, events %d", names(got), len(repo.events))
	}

	// No room between equal ranks: every item is numbered again, 10, 20, 30…
	d := mk("D", 1000)
	e := mk("E", 1000)
	repo.events = nil
	got, _ = svc.Move(ctx, a.ID, &e.ID, testActor)
	if names(got) != "C,B,D,A,E" {
		t.Fatalf("order %s", names(got))
	}
	for n, i := range got {
		if i.DisplayRank != (n+1)*10 {
			t.Errorf("%s rank %d, want %d", i.Name, i.DisplayRank, (n+1)*10)
		}
	}
	// B kept its 20: four ranks changed.
	if len(repo.events) != 4 {
		t.Errorf("%d events, want one per changed rank (4)", len(repo.events))
	}
	_ = d

	for name, err := range map[string]error{
		"unknown item":   func() error { _, err := svc.Move(ctx, uuid.New(), nil, testActor); return err }(),
		"unknown before": func() error { x := uuid.New(); _, err := svc.Move(ctx, a.ID, &x, testActor); return err }(),
		"before itself":  func() error { _, err := svc.Move(ctx, a.ID, &a.ID, testActor); return err }(),
		"no actor":       func() error { _, err := svc.Move(ctx, a.ID, nil, uuid.Nil); return err }(),
	} {
		want := ErrInvalid
		if name == "unknown item" {
			want = ErrNotFound
		}
		if !errors.Is(err, want) {
			t.Errorf("%s: err = %v, want %v", name, err, want)
		}
	}
}
