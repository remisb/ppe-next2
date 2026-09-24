package order

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/size"
)

// fakeRepo simulates the Mark as Ordered transaction over in-memory rows:
// build sees a snapshot, and nothing is stored when it fails.
type fakeRepo struct {
	employees  map[uuid.UUID]EmployeeView
	items      map[uuid.UUID]ItemView
	users      map[uuid.UUID]string
	seq        int64
	orders     map[uuid.UUID]Order
	events     []audit.Event
	lastFilter ListFilter
	links      []Confirmation
}

func (f *fakeRepo) CreateLink(_ context.Context, orderID uuid.UUID, fn LinkFunc) error {
	o, ok := f.orders[orderID]
	if !ok {
		return ErrNotFound
	}
	c, ev, err := fn(o)
	if err != nil {
		return err
	}
	for i := range f.links {
		l := &f.links[i]
		if l.OrderID == orderID && l.Method == MethodElectronic && l.RevokedAt == nil && l.ConfirmedAt == nil {
			l.RevokedAt = &c.CreatedAt
		}
	}
	f.links = append(f.links, c)
	f.events = append(f.events, ev)
	return nil
}

func (f *fakeRepo) LinkByHash(_ context.Context, h string) (Confirmation, error) {
	for _, l := range f.links {
		if l.TokenHash != nil && *l.TokenHash == h {
			return l, nil
		}
	}
	return Confirmation{}, ErrLinkExpired
}

func (f *fakeRepo) Confirm(_ context.Context, orderID uuid.UUID, linkID *uuid.UUID, giver uuid.UUID, fn ConfirmFunc) (Order, error) {
	o, ok := f.orders[orderID]
	if !ok {
		return Order{}, ErrNotFound
	}
	snap := ConfirmSnapshot{Order: o, GiverName: f.users[giver]}
	if linkID != nil {
		for i := range f.links {
			if f.links[i].ID == *linkID {
				l := f.links[i]
				snap.Link = &l
			}
		}
	}
	res, err := fn(snap)
	if err != nil || res.Noop {
		return o, err
	}
	f.orders[orderID] = res.Order
	if res.IsNew {
		f.links = append(f.links, res.Confirmation)
	} else {
		for i := range f.links {
			if f.links[i].ID == res.Confirmation.ID {
				f.links[i] = res.Confirmation
			}
		}
	}
	for i := range f.links {
		l := &f.links[i]
		if l.OrderID == orderID && l.ID != res.Confirmation.ID && l.Method == MethodElectronic && l.RevokedAt == nil && l.ConfirmedAt == nil {
			l.RevokedAt = res.Order.GivenAt
		}
	}
	f.events = append(f.events, res.Event)
	return res.Order, nil
}

func (f *fakeRepo) ConfirmedFor(_ context.Context, orderID uuid.UUID) (Confirmation, error) {
	for _, l := range f.links {
		if l.OrderID == orderID && l.ConfirmedAt != nil {
			return l, nil
		}
	}
	return Confirmation{}, ErrNotFound
}

func (f *fakeRepo) Create(_ context.Context, employeeID uuid.UUID, itemIDs []uuid.UUID, preparer uuid.UUID, build Build) (Order, error) {
	emp, ok := f.employees[employeeID]
	if !ok {
		return Order{}, ErrEmployeeNotFound
	}
	name, ok := f.users[preparer]
	if !ok {
		return Order{}, ErrActorNotFound
	}
	items := map[uuid.UUID]ItemView{}
	for _, id := range itemIDs {
		if it, ok := f.items[id]; ok {
			items[id] = it
		}
	}
	f.seq++
	o, ev, err := build(Snapshot{Employee: emp, Items: items, PreparedByName: name, RecordSeq: f.seq})
	if err != nil {
		return Order{}, err
	}
	f.orders[o.ID] = o
	f.events = append(f.events, ev)
	return o, nil
}

func (f *fakeRepo) List(_ context.Context, lf ListFilter) ([]Order, int, error) {
	f.lastFilter = lf
	var out []Order
	for _, o := range f.orders {
		out = append(out, o)
	}
	return out, len(out), nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (Order, error) {
	o, ok := f.orders[id]
	if !ok {
		return Order{}, ErrNotFound
	}
	return o, nil
}

type markFixture struct {
	svc                          *Service
	repo                         *fakeRepo
	actor, emp                   uuid.UUID
	shoes, jacket, gloves, draft uuid.UUID
	retired                      uuid.UUID
}

func newMarkFixture() markFixture {
	f := markFixture{actor: uuid.New(), emp: uuid.New(), shoes: uuid.New(), jacket: uuid.New(), gloves: uuid.New(), draft: uuid.New(), retired: uuid.New()}
	item := func(id uuid.UUID, name string, g size.Group, cents int64) ItemView {
		return ItemView{ID: id, Name: name, Details: name + " model", SizeGroup: g, UnitPriceCents: i64(cents), Currency: "EUR", ServicePeriodMonths: ip(12), Active: true}
	}
	draft := item(f.draft, "Helmet", size.GroupNone, 0)
	draft.ServicePeriodMonths = nil
	retired := item(f.retired, "Old vest", size.GroupNone, 100)
	retired.Active = false
	f.repo = &fakeRepo{
		employees: map[uuid.UUID]EmployeeView{f.emp: {ID: f.emp, FirstName: "Jonas", LastName: "Petraitis", Code: sp("W-17")}},
		items: map[uuid.UUID]ItemView{
			f.shoes: item(f.shoes, "Safety shoes", size.GroupShoes, 4999), f.jacket: item(f.jacket, "Work jacket", size.GroupClothing, 3999),
			f.gloves: item(f.gloves, "Protective gloves", size.GroupNone, 250), f.draft: draft, f.retired: retired,
		},
		users:  map[uuid.UUID]string{f.actor: "Admin"},
		orders: map[uuid.UUID]Order{},
	}
	f.svc = NewService(f.repo, Readers{}, WithClock(func() time.Time { return time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC) }))
	return f
}

func TestMarkAsOrderedSnapshots(t *testing.T) {
	f := newMarkFixture()
	o, err := f.svc.MarkAsOrdered(context.Background(), MarkAsOrderedParams{EmployeeID: f.emp, Lines: []LineParams{
		{f.jacket, 1, sp("L")}, {f.shoes, 1, sp("43")}, {f.gloves, 10, nil},
	}}, f.actor)
	if err != nil {
		t.Fatal(err)
	}
	if o.Status != StatusOrdered || o.RecordNumber() != "WE-000001" || o.PreparedByName != "Admin" ||
		o.EmployeeFirstName != "Jonas" || *o.EmployeeCode != "W-17" || o.GivenAt != nil {
		t.Errorf("order = %+v", o)
	}
	l := o.Lines
	if len(l) != 3 || l[0].LineNo != 1 || l[0].ItemName != "Work jacket" || *l[0].Size != "L" ||
		l[1].UnitPriceCents != 4999 || l[2].Size != nil || l[2].Quantity != 10 || l[2].ServicePeriodMonths != 12 {
		t.Errorf("lines = %+v", l)
	}
	if o.TotalCents() != 3999+4999+2500 {
		t.Errorf("total = %d", o.TotalCents())
	}
	if len(f.repo.events) != 1 || f.repo.events[0].Event != EventOrdered || !strings.Contains(string(f.repo.events[0].After), `"record_number":"WE-000001"`) {
		t.Errorf("events = %+v", f.repo.events)
	}

	// The catalogue changing afterwards does not touch the stored snapshot.
	it := f.repo.items[f.shoes]
	it.UnitPriceCents = i64(9999)
	f.repo.items[f.shoes] = it
	stored, _ := f.svc.Get(context.Background(), o.ID)
	if stored.Lines[1].UnitPriceCents != 4999 {
		t.Errorf("snapshot changed with the catalogue")
	}
}

func TestMarkAsOrderedRejections(t *testing.T) {
	f := newMarkFixture()
	ctx := context.Background()
	cases := map[string]struct {
		p     MarkAsOrderedParams
		actor uuid.UUID
		want  error
	}{
		"no lines":             {MarkAsOrderedParams{EmployeeID: f.emp}, f.actor, ErrInvalid},
		"nil actor":            {MarkAsOrderedParams{f.emp, []LineParams{{f.gloves, 1, nil}}}, uuid.Nil, ErrInvalid},
		"unknown actor":        {MarkAsOrderedParams{f.emp, []LineParams{{f.gloves, 1, nil}}}, uuid.New(), ErrActorNotFound},
		"unknown employee":     {MarkAsOrderedParams{uuid.New(), []LineParams{{f.gloves, 1, nil}}}, f.actor, ErrEmployeeNotFound},
		"missing size":         {MarkAsOrderedParams{f.emp, []LineParams{{f.shoes, 1, nil}}}, f.actor, ErrInvalid},
		"wrong group size":     {MarkAsOrderedParams{f.emp, []LineParams{{f.shoes, 1, sp("M")}}}, f.actor, ErrInvalid},
		"size on no-size item": {MarkAsOrderedParams{f.emp, []LineParams{{f.gloves, 1, sp("M")}}}, f.actor, ErrInvalid},
		"price missing":        {MarkAsOrderedParams{f.emp, []LineParams{{f.draft, 1, nil}}}, f.actor, ErrPriceMissing},
		"inactive item":        {MarkAsOrderedParams{f.emp, []LineParams{{f.retired, 1, nil}}}, f.actor, ErrItemUnavailable},
		"deleted item":         {MarkAsOrderedParams{f.emp, []LineParams{{uuid.New(), 1, nil}}}, f.actor, ErrItemUnavailable},
		"zero quantity":        {MarkAsOrderedParams{f.emp, []LineParams{{f.gloves, 0, nil}}}, f.actor, ErrInvalid},
	}
	for name, c := range cases {
		if _, err := f.svc.MarkAsOrdered(ctx, c.p, c.actor); !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", name, err, c.want)
		}
	}
	if len(f.repo.orders) != 0 || len(f.repo.events) != 0 {
		t.Errorf("a rejected order was stored: %d orders, %d events", len(f.repo.orders), len(f.repo.events))
	}
	_, err := f.svc.MarkAsOrdered(ctx, MarkAsOrderedParams{f.emp, []LineParams{{f.draft, 1, nil}}}, f.actor)
	if err == nil || !strings.Contains(err.Error(), "Helmet") {
		t.Errorf("price-missing error should name the item: %v", err)
	}
}
