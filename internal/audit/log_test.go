package audit

import (
	"context"
	"errors"
	"os"
	"regexp"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCursorRoundTrip(t *testing.T) {
	c := Cursor{At: time.Date(2026, 10, 7, 9, 42, 18, 123456000, time.UTC), ID: uuid.New()}
	got, err := ParseCursor(c.String())
	if err != nil || !got.At.Equal(c.At) || got.ID != c.ID {
		t.Fatalf("round trip = %+v, %v", got, err)
	}
	for _, bad := range []string{"", "!!", "bm90LWEtY3Vyc29y"} {
		if _, err := ParseCursor(bad); !errors.Is(err, ErrInvalid) {
			t.Errorf("%q: err = %v, want ErrInvalid", bad, err)
		}
	}
}

func TestFilterResolve(t *testing.T) {
	vilnius, _ := time.LoadLocation("Europe/Vilnius")
	id := uuid.New()
	q, err := Filter{Area: AreaUsers, FromDate: "2026-10-01", ToDate: "2026-10-07"}.resolve(vilnius)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(q.EntityTypes, []string{"user", "role"}) || q.Limit != DefaultPageSize {
		t.Errorf("query = %+v", q)
	}
	// Calendar days in the organisation's timezone: midnight there, the end exclusive.
	if !q.From.Equal(time.Date(2026, 9, 30, 21, 0, 0, 0, time.UTC)) || !q.To.Equal(time.Date(2026, 10, 7, 21, 0, 0, 0, time.UTC)) {
		t.Errorf("from %v to %v", q.From, q.To)
	}
	q, err = Filter{EntityType: "employee", EntityID: &id, PageSize: 10}.resolve(vilnius)
	if err != nil || !slices.Equal(q.EntityTypes, []string{"employee"}) || *q.EntityID != id || q.Limit != 10 {
		t.Errorf("entity query = %+v, %v", q, err)
	}
	for name, f := range map[string]Filter{
		"unknown area":        {Area: "payroll"},
		"unknown event":       {Event: "employee.hired"},
		"entity without type": {EntityID: &id},
		"unknown entity type": {EntityType: "invoice"},
		"entity outside area": {Area: AreaOrders, EntityType: "employee"},
		"page too big":        {PageSize: MaxPageSize + 1},
		"negative page":       {PageSize: -1},
		"bad from":            {FromDate: "07.10.2026"},
		"bad to":              {ToDate: "2026-13-01"},
		"to before from":      {FromDate: "2026-10-07", ToDate: "2026-10-06"},
	} {
		if _, err := f.resolve(vilnius); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v, want ErrInvalid", name, err)
		}
	}
}

// pagedStore returns rows newest first, honouring Limit and After as Postgres
// does; it keeps no seals (memTrail, seal_test.go, does).
type pagedStore struct {
	memTrail
	rows []Entry
}

func (s pagedStore) List(_ context.Context, q Query) ([]Entry, error) {
	var out []Entry
	for _, e := range s.rows {
		if q.After != nil && !(e.OccurredAt.Before(q.After.At) || (e.OccurredAt.Equal(q.After.At) && e.ID.String() < q.After.ID.String())) {
			continue
		}
		if len(out) < q.Limit {
			out = append(out, e)
		}
	}
	return out, nil
}

func TestListPages(t *testing.T) {
	base := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	var rows []Entry
	for i := range 5 {
		rows = append(rows, Entry{ID: uuid.New(), OccurredAt: base.Add(-time.Duration(i) * time.Minute)})
	}
	svc := NewService(pagedStore{rows: rows})
	var seen []uuid.UUID
	f := Filter{PageSize: 2}
	for range 4 {
		page, err := svc.List(context.Background(), f)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range page.Events {
			seen = append(seen, e.ID)
		}
		if page.Next == nil {
			break
		}
		c, err := ParseCursor(*page.Next)
		if err != nil {
			t.Fatal(err)
		}
		f.After = &c
	}
	if len(seen) != 5 || seen[0] != rows[0].ID || seen[4] != rows[4].ID {
		t.Fatalf("paged through %d of 5 events", len(seen))
	}
	empty, err := NewService(pagedStore{}).List(context.Background(), Filter{})
	if err != nil || empty.Events == nil || len(empty.Events) != 0 || empty.Next != nil {
		t.Errorf("empty page = %+v, %v; want [] and no next", empty, err)
	}
}

func TestRequestFromDefaultsToSystem(t *testing.T) {
	if r := RequestFrom(context.Background()); r.Source != SourceSystem || r.ID != "" || r.SessionID != uuid.Nil {
		t.Errorf("no request = %+v", r)
	}
	want := Request{ID: "r1", SessionID: uuid.New(), Source: SourceAdmin}
	if got := RequestFrom(WithRequest(context.Background(), want)); got != want {
		t.Errorf("request = %+v, want %+v", got, want)
	}
}

// TestWebClientListsTheEvents keeps @ppe/api-client's AUDIT_EVENTS and
// AUDIT_AREAS, which the apps' words are typed against, in step with Go.
func TestWebClientListsTheEvents(t *testing.T) {
	src, err := os.ReadFile("../../web/packages/api-client/src/audit.ts")
	if err != nil {
		t.Fatal(err)
	}
	read := func(name string) []string {
		list := regexp.MustCompile(`(?s)` + name + ` = \[(.*?)\] as const`).FindSubmatch(src)
		if list == nil {
			t.Fatalf("no %s list in audit.ts", name)
		}
		var out []string
		for _, m := range regexp.MustCompile(`'([^']+)'`).FindAllSubmatch(list[1], -1) {
			out = append(out, string(m[1]))
		}
		return out
	}
	if web := read("AUDIT_EVENTS"); !slices.Equal(web, Events()) {
		t.Errorf("audit.ts lists events %v, Go %v", web, Events())
	}
	var areas []string
	for _, a := range Areas() {
		areas = append(areas, string(a))
	}
	if web := read("AUDIT_AREAS"); !slices.Equal(web, areas) {
		t.Errorf("audit.ts lists areas %v, Go %v", web, areas)
	}
}
