package audit

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// memTrail keeps events, seals and purges in memory as the Postgres store does.
type memTrail struct {
	mu       *sync.Mutex
	events   *[]Row
	seals    *[]Seal
	stamps   *[]Stamp
	purges   *[]Purge
	inserted *[]Event
}

func newMemTrail() memTrail {
	return memTrail{mu: &sync.Mutex{}, events: &[]Row{}, seals: &[]Seal{}, stamps: &[]Stamp{}, purges: &[]Purge{}, inserted: &[]Event{}}
}

func (m memTrail) lock() func() {
	if m.mu == nil {
		return func() {}
	}
	m.mu.Lock()
	return m.mu.Unlock
}

func (m memTrail) List(_ context.Context, q Query) ([]Entry, error) {
	defer m.lock()()
	var out []Entry
	rows := slices.Clone(*m.events)
	slices.SortFunc(rows, func(a, b Row) int { return b.OccurredAt.Compare(a.OccurredAt) })
	for _, r := range rows {
		if (q.From != nil && r.OccurredAt.Before(*q.From)) || (q.To != nil && !r.OccurredAt.Before(*q.To)) {
			continue
		}
		if q.After != nil && !r.OccurredAt.Before(q.After.At) {
			continue
		}
		if len(out) < q.Limit {
			e := Entry{ID: r.ID, OccurredAt: r.OccurredAt, Event: r.Event, EntityType: r.EntityType, EntityID: r.EntityID, Area: AreaOf(r.EntityType)}
			if r.After != nil {
				e.After = json.RawMessage(*r.After)
			}
			out = append(out, e)
		}
	}
	return out, nil
}

func (m memTrail) Insert(_ context.Context, ev Event) error {
	if m.inserted == nil {
		return nil
	}
	defer m.lock()()
	*m.inserted = append(*m.inserted, ev)
	return nil
}

func (m memTrail) EachRow(_ context.Context, from, to time.Time, f func(Row) error) error {
	if m.events == nil {
		return nil
	}
	m.mu.Lock()
	rows := slices.Clone(*m.events)
	m.mu.Unlock()
	slices.SortFunc(rows, func(a, b Row) int {
		if c := a.OccurredAt.Compare(b.OccurredAt); c != 0 {
			return c
		}
		return strings.Compare(a.ID.String(), b.ID.String())
	})
	for _, r := range rows {
		if !r.OccurredAt.Before(from) && r.OccurredAt.Before(to) {
			if err := f(r); err != nil {
				return err
			}
		}
	}
	return nil
}

func (m memTrail) FirstEventAt(context.Context) (*time.Time, error) {
	if m.events == nil {
		return nil, nil
	}
	defer m.lock()()
	var first *time.Time
	for _, r := range *m.events {
		if first == nil || r.OccurredAt.Before(*first) {
			t := r.OccurredAt
			first = &t
		}
	}
	return first, nil
}

func (m memTrail) Seals(context.Context) ([]Seal, error) {
	if m.seals == nil {
		return nil, nil
	}
	defer m.lock()()
	return slices.Clone(*m.seals), nil
}

func (m memTrail) AddSeal(_ context.Context, s Seal) error {
	defer m.lock()()
	for _, x := range *m.seals {
		if x.Day.Equal(s.Day) {
			return ErrSealed
		}
	}
	*m.seals = append(*m.seals, s)
	return nil
}

func (m memTrail) Stamps(context.Context) ([]Stamp, error) {
	if m.stamps == nil {
		return nil, nil
	}
	defer m.lock()()
	out := slices.Clone(*m.stamps)
	slices.SortFunc(out, func(a, b Stamp) int { return a.Day.Compare(b.Day) })
	return out, nil
}

func (m memTrail) AddStamp(_ context.Context, st Stamp) error {
	defer m.lock()()
	for _, x := range *m.stamps {
		if x.Day.Equal(st.Day) {
			return ErrStamped
		}
	}
	*m.stamps = append(*m.stamps, st)
	return nil
}

func (m memTrail) Purges(context.Context) ([]Purge, error) {
	if m.purges == nil {
		return nil, nil
	}
	defer m.lock()()
	return slices.Clone(*m.purges), nil
}

func (m memTrail) Purge(_ context.Context, p Purge, ev func(int64) (Event, error)) (Purge, error) {
	defer m.lock()()
	kept := (*m.events)[:0]
	for _, r := range *m.events {
		if r.OccurredAt.Before(p.BeforeDay) {
			p.Rows++
		} else {
			kept = append(kept, r)
		}
	}
	*m.events = kept
	*m.purges = append(*m.purges, p)
	e, err := ev(p.Rows)
	if err == nil {
		*m.inserted = append(*m.inserted, e)
	}
	return p, err
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time { return c.t }

func row(at time.Time, event string) Row {
	after := `{"name": "x"}`
	return Row{ID: uuid.New(), Event: event, EntityType: "employee", EntityID: uuid.New(), OccurredAt: at, After: &after}
}

// Each ended day is sealed once, chained to the one before, an empty day too;
// today and the hour after midnight wait. Verify finds them whole, then finds
// a changed, an added and a removed event, and a broken chain.
func TestSealAndVerify(t *testing.T) {
	trail := newMemTrail()
	d0 := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	*trail.events = []Row{
		row(d0.Add(9*time.Hour), "employee.created"),
		row(d0.Add(10*time.Hour), "employee.updated"),
		row(d0.Add(2*Day+time.Hour), "employee.deleted"),
	}
	c := &clock{d0.Add(3*Day + 30*time.Minute)} // 4 Oct 00:30: 3 Oct is within the grace
	svc := NewService(trail, WithClock(c.now))
	ctx := context.Background()

	n, err := svc.SealDays(ctx)
	if err != nil || n != 2 {
		t.Fatalf("sealed %d, %v; want 1 and 2 Oct", n, err)
	}
	c.t = c.t.Add(time.Hour)
	if n, _ := svc.SealDays(ctx); n != 1 {
		t.Fatalf("after the grace sealed %d, want 3 Oct", n)
	}
	if n, _ := svc.SealDays(ctx); n != 0 {
		t.Errorf("sealed again: %d", n)
	}
	seals := *trail.seals
	if len(seals) != 3 || seals[0].Rows != 2 || seals[1].Rows != 0 || seals[2].Rows != 1 ||
		seals[0].PrevHash != nil || !bytes.Equal(seals[1].PrevHash, seals[0].Hash) || !bytes.Equal(seals[2].PrevHash, seals[1].Hash) {
		t.Fatalf("seals = %+v", seals)
	}

	*trail.events = append(*trail.events, row(c.t.Add(-time.Minute), "employee.updated")) // today: not yet sealed
	v, err := svc.Verify(ctx)
	if err != nil || !v.OK || v.Days != 3 || v.Rows != 3 || v.Unsealed != 1 || !v.FirstDay.Equal(d0) || !v.LastDay.Equal(d0.Add(2*Day)) {
		t.Fatalf("verify = %+v, %v", v, err)
	}
	if svc.LastVerification() == nil || !svc.LastVerification().OK {
		t.Error("the result was not kept")
	}

	original := slices.Clone(*trail.events)
	for name, tamper := range map[string]func(){
		"changed": func() { changed := `{"name": "y"}`; (*trail.events)[0].After = &changed },
		"added":   func() { *trail.events = append(*trail.events, row(d0.Add(Day+time.Hour), "employee.created")) },
		"removed": func() { *trail.events = (*trail.events)[1:] },
	} {
		*trail.events = slices.Clone(original)
		tamper()
		v, _ := svc.Verify(ctx)
		if v.OK || v.Mismatch == nil {
			t.Errorf("%s event not found: %+v", name, v)
		}
	}
	*trail.events = original
	if v, _ := svc.Verify(ctx); v.Mismatch != nil {
		t.Fatalf("restored = %+v", v.Mismatch)
	}

	(*trail.seals)[1].PrevHash = []byte(strings.Repeat("x", 32))
	v, _ = svc.Verify(ctx)
	if v.OK || v.Mismatch.Problem != "chain" || !v.Mismatch.Day.Equal(d0.Add(Day)) {
		t.Errorf("broken chain = %+v", v.Mismatch)
	}
	(*trail.seals)[1].PrevHash = seals[0].Hash
	*trail.seals = append((*trail.seals)[:1], (*trail.seals)[2:]...)
	if v, _ := svc.Verify(ctx); v.OK || v.Mismatch.Problem != "gap" {
		t.Errorf("missing seal = %+v", v.Mismatch)
	}
}

// Retention purges whole sealed days older than it, records the purge, and
// Verify then checks those days by their chain only.
func TestPurgeExpired(t *testing.T) {
	trail := newMemTrail()
	d0 := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	*trail.events = []Row{row(d0.Add(time.Hour), "employee.created"), row(d0.Add(400*Day), "employee.updated")}
	c := &clock{d0.Add(401*Day + 2*time.Hour)}
	svc := NewService(trail, WithClock(c.now), WithRetention(365*Day))
	ctx := context.Background()

	// Nothing is purged before it is sealed.
	if n, err := svc.PurgeExpired(ctx); err != nil || n != 0 {
		t.Fatalf("unsealed purge = %d, %v", n, err)
	}
	if _, err := svc.SealDays(ctx); err != nil {
		t.Fatal(err)
	}
	n, err := svc.PurgeExpired(ctx)
	if err != nil || n != 1 || len(*trail.events) != 1 {
		t.Fatalf("purged %d, %v; %d left", n, err, len(*trail.events))
	}
	p := (*trail.purges)[0]
	ev := (*trail.inserted)[0]
	if !p.BeforeDay.Equal(d0.Add(36*Day)) || ev.Event != EventPurged || ev.ActorUserID != nil ||
		!strings.Contains(string(ev.After), `"rows":1`) || !strings.Contains(string(ev.After), `"older_than":"2024-02-06"`) {
		t.Errorf("purge %+v, event %s", p, ev.After)
	}
	if n, _ := svc.PurgeExpired(ctx); n != 0 || len(*trail.purges) != 1 {
		t.Error("purged again with nothing to purge")
	}
	v, err := svc.Verify(ctx)
	if err != nil || !v.OK || v.PurgedDays != 36 || v.Rows != 1 {
		t.Errorf("after the purge, verify = %+v, %v", v, err)
	}
	if n, _ := NewService(trail).PurgeExpired(ctx); n != 0 {
		t.Error("no retention purged")
	}
}

// An export needs both days, at most a year apart, records itself first, and
// writes CSV safe for spreadsheets or one JSON object a line.
func TestExport(t *testing.T) {
	trail := newMemTrail()
	vilnius, _ := time.LoadLocation("Europe/Vilnius")
	at := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	r := row(at, "employee.created")
	*trail.events = []Row{r, row(at.Add(-40*Day), "employee.updated")}
	svc := NewService(trail, WithLocation(vilnius), WithClock(func() time.Time { return at }))
	ctx := context.Background()
	actor := uuid.New()

	for name, f := range map[string]Filter{
		"no to":     {FromDate: "2026-10-01"},
		"too long":  {FromDate: "2025-01-01", ToDate: "2026-10-01"},
		"bad event": {FromDate: "2026-10-01", ToDate: "2026-10-01", Event: "x"},
	} {
		if err := svc.Export(ctx, f, FormatCSV, actor, &bytes.Buffer{}); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if err := svc.Export(ctx, Filter{FromDate: "2026-10-01", ToDate: "2026-10-01"}, "xlsx", actor, &bytes.Buffer{}); !errors.Is(err, ErrInvalid) {
		t.Errorf("xlsx: %v", err)
	}
	if len(*trail.inserted) != 0 {
		t.Fatal("a refused export was recorded")
	}

	var out bytes.Buffer
	if err := svc.Export(ctx, Filter{FromDate: "2026-09-01", ToDate: "2026-10-01", Area: AreaEmployees}, FormatCSV, actor, &out); err != nil {
		t.Fatal(err)
	}
	recs, err := csv.NewReader(&out).ReadAll()
	if err != nil || len(recs) != 2 || recs[0][0] != "occurred_at" || recs[1][1] != "employee.created" ||
		recs[1][0] != "2026-10-01T12:00:00.000000+03:00" || recs[1][len(recs[1])-1] != r.ID.String() {
		t.Fatalf("csv = %v, %v", recs, err)
	}
	ev := (*trail.inserted)[0]
	if ev.Event != EventExported || *ev.ActorUserID != actor || !strings.Contains(string(ev.After), `"area":"employees"`) {
		t.Errorf("recorded %+v %s", ev, ev.After)
	}

	out.Reset()
	if err := svc.Export(ctx, Filter{FromDate: "2026-08-01", ToDate: "2026-10-01"}, FormatJSONL, actor, &out); err != nil {
		t.Fatal(err)
	}
	if lines := strings.Split(strings.TrimSpace(out.String()), "\n"); len(lines) != 2 || !strings.HasPrefix(lines[0], `{"id":"`+r.ID.String()) {
		t.Errorf("jsonl = %s", out.String())
	}
	if safeCell("=HYPERLINK(1)") != "'=HYPERLINK(1)" || safeCell("Ona") != "Ona" {
		t.Error("a formula is not defused")
	}
}
