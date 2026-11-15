package supplier

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
)

// fakeRepo mirrors the contract: live-only reads, codes unique among live
// suppliers case-insensitively.
type fakeRepo struct {
	mu     sync.Mutex
	rows   map[uuid.UUID]Supplier
	events []audit.Event
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[uuid.UUID]Supplier{}} }

func (f *fakeRepo) codeTaken(code string, except uuid.UUID) bool {
	for _, s := range f.rows {
		if s.ID != except && !s.Deleted() && strings.EqualFold(s.Code, code) {
			return true
		}
	}
	return false
}

func (f *fakeRepo) Create(_ context.Context, s Supplier, ev audit.Event) (Supplier, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.codeTaken(s.Code, s.ID) {
		return Supplier{}, ErrCodeTaken
	}
	f.rows[s.ID] = s
	f.events = append(f.events, ev)
	return s, nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (Supplier, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.rows[id]
	if !ok || s.Deleted() {
		return Supplier{}, ErrNotFound
	}
	return s, nil
}

func (f *fakeRepo) List(context.Context) ([]Supplier, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Supplier, 0)
	for _, s := range f.rows {
		if !s.Deleted() {
			out = append(out, s)
		}
	}
	slices.SortFunc(out, func(a, b Supplier) int { return strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)) })
	return out, nil
}

func (f *fakeRepo) Update(_ context.Context, id uuid.UUID, m Mutation) (Supplier, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[id]
	if !ok || cur.Deleted() {
		return Supplier{}, ErrNotFound
	}
	next, evs, err := m(cur)
	if err != nil {
		return Supplier{}, err
	}
	if len(evs) == 0 {
		return cur, nil
	}
	if !next.Deleted() && f.codeTaken(next.Code, id) {
		return Supplier{}, ErrCodeTaken
	}
	f.rows[id] = next
	f.events = append(f.events, evs...)
	return next, nil
}

var (
	actor = uuid.MustParse("00000000-0000-4000-8000-0000000000aa")
	t0    = time.Date(2026, 11, 15, 9, 0, 0, 0, time.UTC)
)

func newService() (*Service, *fakeRepo) {
	repo := newFakeRepo()
	return NewService(repo, WithClock(func() time.Time { return t0 })), repo
}

func TestValidate(t *testing.T) {
	ok := Params{Code: "SUP-1", Name: "Darbo rūbai, UAB"}
	tests := []struct {
		name  string
		edit  func(p *Params)
		field string // "" for valid
	}{
		{"minimal", func(*Params) {}, ""},
		{"no code", func(p *Params) { p.Code = "  " }, "code"},
		{"long code", func(p *Params) { p.Code = strings.Repeat("x", 33) }, "code"},
		{"no name", func(p *Params) { p.Name = "" }, "name"},
		{"country lower case is upper-cased", func(p *Params) { p.Country = "lt" }, ""},
		{"country of three letters", func(p *Params) { p.Country = "LTU" }, "country"},
		{"email", func(p *Params) { p.Email = "Orders@Example.LT" }, ""},
		{"not an email", func(p *Params) { p.Email = "orders at example" }, "email"},
		{"email with a display name", func(p *Params) { p.Email = "Orders <orders@example.lt>" }, "email"},
		{"long notes", func(p *Params) { p.Notes = strings.Repeat("ž", 2001) }, "notes"},
		{"notes at the limit in letters, not bytes", func(p *Params) { p.Notes = strings.Repeat("ž", 2000) }, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := ok
			tc.edit(&p)
			err := p.Validate()
			if tc.field == "" {
				if err != nil {
					t.Fatalf("Validate() = %v, want nil", err)
				}
				return
			}
			if !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), tc.field) {
				t.Fatalf("Validate() = %v, want ErrInvalid naming %s", err, tc.field)
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	p := Params{Code: " SUP-1 ", Name: " Name ", VATCode: "lt 100 001 919 017", Country: " lt",
		Email: " Orders@Example.LT ", BankAccount: "lt12 1000 0111 0100 1000"}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	if p.Code != "SUP-1" || p.Name != "Name" || p.VATCode != "LT100001919017" || p.Country != "LT" ||
		p.Email != "orders@example.lt" || p.BankAccount != "LT121000011101001000" {
		t.Errorf("normalized = %+v", p)
	}
}

func TestCreateUpdateDelete(t *testing.T) {
	ctx := context.Background()
	svc, repo := newService()

	if _, err := svc.Create(ctx, Params{Code: "A", Name: "A"}, uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("no actor: %v", err)
	}
	s, err := svc.Create(ctx, Params{Code: "SUP-1", Name: "Darbo rūbai", City: "Vilnius", Notes: "Calls back"}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if s.CreatedAt != t0 || s.CreatedByUserID != actor || s.City != "Vilnius" {
		t.Errorf("created = %+v", s)
	}
	if ev := repo.events[0]; ev.Event != EventCreated || ev.EntityType != Entity || ev.EntityID != s.ID {
		t.Errorf("event = %+v", ev)
	} else if strings.Contains(string(ev.After), "Calls back") {
		t.Errorf("created event records the notes: %s", ev.After)
	}
	if _, err := svc.Create(ctx, Params{Code: "sup-1", Name: "Other"}, actor); !errors.Is(err, ErrCodeTaken) {
		t.Errorf("same code, other case: %v", err)
	}

	// Saving what it has records nothing.
	if _, err := svc.Update(ctx, s.ID, Params{Code: "SUP-1", Name: "Darbo rūbai", City: "Vilnius", Notes: "Calls back"}, actor); err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 1 {
		t.Fatalf("unchanged update recorded %d events", len(repo.events)-1)
	}

	got, err := svc.Update(ctx, s.ID, Params{Code: "SUP-1", Name: "Darbo rūbai, UAB", City: "Kaunas", Notes: "Emails"}, actor)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Darbo rūbai, UAB" || got.City != "Kaunas" || got.Notes != "Emails" {
		t.Errorf("updated = %+v", got)
	}
	ev := repo.events[len(repo.events)-1]
	var before, after map[string]any
	_ = json.Unmarshal(ev.Before, &before)
	_ = json.Unmarshal(ev.After, &after)
	if ev.Event != EventUpdated || before["city"] != "Vilnius" || after["city"] != "Kaunas" ||
		after["name"] != "Darbo rūbai, UAB" || after["notes_changed"] != true || after["code"] != nil {
		t.Errorf("updated event = %s before %s after %s", ev.Event, ev.Before, ev.After)
	}
	if strings.Contains(string(ev.After), "Emails") {
		t.Errorf("updated event records the notes' text: %s", ev.After)
	}

	if err := svc.Delete(ctx, s.ID, actor); err != nil {
		t.Fatal(err)
	}
	if ev := repo.events[len(repo.events)-1]; ev.Event != EventDeleted {
		t.Errorf("last event = %s", ev.Event)
	}
	if _, err := svc.Get(ctx, s.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleted supplier read: %v", err)
	}
	if err := svc.Delete(ctx, s.ID, actor); !errors.Is(err, ErrNotFound) {
		t.Errorf("deleting twice: %v", err)
	}
	// Its code is free again.
	if _, err := svc.Create(ctx, Params{Code: "SUP-1", Name: "New"}, actor); err != nil {
		t.Errorf("reusing a deleted supplier's code: %v", err)
	}
}
