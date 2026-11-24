package share

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// memRepo is an in-memory Repository keeping the contract's rules.
type memRepo struct {
	rows   map[uuid.UUID]Share
	events []audit.Event
}

func newMemRepo() *memRepo { return &memRepo{rows: map[uuid.UUID]Share{}} }

func (m *memRepo) Create(_ context.Context, s Share, ev audit.Event) (Share, error) {
	s.CreatedByName = "Sharer"
	m.rows[s.ID] = s
	m.events = append(m.events, ev)
	return s, nil
}

func (m *memRepo) ByTokenHash(_ context.Context, hash string) (Share, error) {
	for _, s := range m.rows {
		if s.TokenHash == hash {
			return s, nil
		}
	}
	return Share{}, ErrNotFound
}

func (m *memRepo) ListOpen(_ context.Context, actor uuid.UUID, now time.Time) ([]Share, error) {
	out := make([]Share, 0)
	for _, s := range m.rows {
		if s.CreatedByUserID == actor && s.Open(now) {
			s.Rows = []json.RawMessage{}
			out = append(out, s)
		}
	}
	slices.SortFunc(out, func(a, b Share) int { return b.CreatedAt.Compare(a.CreatedAt) })
	return out, nil
}

func (m *memRepo) Update(_ context.Context, id uuid.UUID, f Mutation) (Share, error) {
	cur, ok := m.rows[id]
	if !ok {
		return Share{}, ErrNotFound
	}
	next, evs, err := f(cur)
	if err != nil {
		return Share{}, err
	}
	if len(evs) > 0 {
		m.rows[id] = next
		m.events = append(m.events, evs...)
	}
	return m.rows[id], nil
}

func (m *memRepo) EraseExpired(_ context.Context, now time.Time) (int, error) {
	n := 0
	for id, s := range m.rows {
		if s.ErasedAt == nil && !now.Before(s.ExpiresAt) {
			s.Rows, s.ErasedAt = []json.RawMessage{}, &now
			m.rows[id] = s
			n++
		}
	}
	return n, nil
}

// clock is a settable test clock.
type clock struct{ at time.Time }

func (c *clock) now() time.Time { return c.at }

func params(n int) CreateParams {
	p := CreateParams{Kind: KindEmployees, Name: " Jonas and Petras ", Columns: []string{"name", "clothing"}, Days: 7}
	for i := range n {
		p.SubjectIDs = append(p.SubjectIDs, uuid.New())
		p.Rows = append(p.Rows, json.RawMessage(`{"full_name":"Person `+string(rune('A'+i))+`"}`))
	}
	return p
}

func TestCreateRules(t *testing.T) {
	actor := uuid.New()
	id := uuid.New()
	cases := []struct {
		name string
		edit func(*CreateParams)
	}{
		{"no rows", func(p *CreateParams) { p.SubjectIDs, p.Rows = nil, nil }},
		{"eleven rows", func(p *CreateParams) { *p = params(11) }},
		{"a record twice", func(p *CreateParams) { p.SubjectIDs = []uuid.UUID{id, id} }},
		{"rows not one per record", func(p *CreateParams) { p.Rows = p.Rows[:1] }},
		{"no name", func(p *CreateParams) { p.Name = "  " }},
		{"long name", func(p *CreateParams) { p.Name = string(make([]rune, 101)) }},
		{"no columns", func(p *CreateParams) { p.Columns = nil }},
		{"a column twice", func(p *CreateParams) { p.Columns = []string{"name", "name"} }},
		{"unknown kind", func(p *CreateParams) { p.Kind = "orders" }},
		{"other days", func(p *CreateParams) { p.Days = 3 }},
		{"rows not JSON", func(p *CreateParams) { p.Rows[0] = json.RawMessage(`{`) }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			p := params(2)
			c.edit(&p)
			if _, _, err := NewService(newMemRepo()).Create(context.Background(), p, actor); !errors.Is(err, ErrInvalid) {
				t.Errorf("err = %v, want ErrInvalid", err)
			}
		})
	}
	if _, _, err := NewService(newMemRepo()).Create(context.Background(), params(1), uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("no actor: %v", err)
	}
	if _, _, err := NewService(newMemRepo()).Create(context.Background(), params(MaxRows), actor); err != nil {
		t.Errorf("ten rows: %v", err)
	}
}

func TestShareLifecycle(t *testing.T) {
	ctx := context.Background()
	repo := newMemRepo()
	c := &clock{at: time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)}
	svc := NewService(repo, WithClock(c.now))
	actor, other := uuid.New(), uuid.New()

	sh, token, err := svc.Create(ctx, params(2), actor)
	if err != nil {
		t.Fatal(err)
	}
	if token == "" || sh.TokenHash != HashToken(token) || sh.TokenHash == token {
		t.Errorf("token %q, hash %q", token, sh.TokenHash)
	}
	if sh.Name != "Jonas and Petras" || sh.RowCount != 2 || !sh.ExpiresAt.Equal(c.at.AddDate(0, 0, 7)) {
		t.Errorf("created = %+v", sh)
	}
	if len(repo.events) != 1 || repo.events[0].Event != EventCreated {
		t.Fatalf("events = %+v", repo.events)
	}
	var after map[string]any
	_ = json.Unmarshal(repo.events[0].After, &after)
	if after["rows"] != float64(2) || after["name"] != "Jonas and Petras" || after["full_name"] != nil {
		t.Errorf("share.created after = %v", after)
	}

	opened, err := svc.Open(ctx, token)
	if err != nil || len(opened.Rows) != 2 {
		t.Fatalf("open = %+v, %v", opened, err)
	}
	if _, err := svc.Open(ctx, "not-a-token"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown token: %v", err)
	}

	mine, _ := svc.List(ctx, actor)
	theirs, _ := svc.List(ctx, other)
	if len(mine) != 1 || len(theirs) != 0 {
		t.Errorf("lists: mine %d, theirs %d", len(mine), len(theirs))
	}

	if err := svc.Revoke(ctx, sh.ID, other); !errors.Is(err, ErrNotFound) {
		t.Errorf("revoke another's: %v", err)
	}
	if err := svc.Revoke(ctx, sh.ID, actor); err != nil {
		t.Fatal(err)
	}
	if got := repo.rows[sh.ID]; got.RevokedAt == nil || got.ErasedAt == nil || len(got.Rows) != 0 {
		t.Errorf("revoked = %+v", got)
	}
	if repo.events[len(repo.events)-1].Event != EventRevoked {
		t.Errorf("last event = %s", repo.events[len(repo.events)-1].Event)
	}
	if err := svc.Revoke(ctx, sh.ID, actor); !errors.Is(err, ErrNotFound) {
		t.Errorf("revoke twice: %v", err)
	}
	if _, err := svc.Open(ctx, token); !errors.Is(err, ErrGone) {
		t.Errorf("open revoked: %v", err)
	}
	if mine, _ := svc.List(ctx, actor); len(mine) != 0 {
		t.Errorf("revoked still listed")
	}
}

func TestExpiry(t *testing.T) {
	ctx := context.Background()
	repo := newMemRepo()
	c := &clock{at: time.Date(2026, 11, 23, 10, 0, 0, 0, time.UTC)}
	svc := NewService(repo, WithClock(c.now))
	actor := uuid.New()
	p := params(1)
	p.Days = 1
	sh, token, err := svc.Create(ctx, p, actor)
	if err != nil {
		t.Fatal(err)
	}
	c.at = c.at.Add(23 * time.Hour)
	if n, _ := svc.EraseExpired(ctx); n != 0 {
		t.Errorf("erased %d before expiry", n)
	}
	if _, err := svc.Open(ctx, token); err != nil {
		t.Errorf("open before expiry: %v", err)
	}
	c.at = c.at.Add(time.Hour)
	if _, err := svc.Open(ctx, token); !errors.Is(err, ErrGone) {
		t.Errorf("open at expiry: %v", err)
	}
	if err := svc.Revoke(ctx, sh.ID, actor); !errors.Is(err, ErrNotFound) {
		t.Errorf("revoke expired: %v", err)
	}
	if n, _ := svc.EraseExpired(ctx); n != 1 || len(repo.rows[sh.ID].Rows) != 0 {
		t.Errorf("erased %d, rows %v", n, repo.rows[sh.ID].Rows)
	}
	if n, _ := svc.EraseExpired(ctx); n != 0 {
		t.Errorf("erased again: %d", n)
	}
}
