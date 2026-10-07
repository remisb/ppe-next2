package audit

import (
	"bytes"
	"context"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"
)

// fakeTSA stamps with its clock's time; its tokens are text it alone makes,
// so one for another hash, or made up, does not check out.
type fakeTSA struct {
	now  func() time.Time
	down bool
}

func (f *fakeTSA) URL() string { return "http://tsa.test" }

func (f *fakeTSA) Stamp(_ context.Context, digest []byte) ([]byte, error) {
	if f.down {
		return nil, errors.New("tsa.test is down")
	}
	return []byte("fake-tsa|" + hex.EncodeToString(digest) + "|" + f.now().Format(time.RFC3339)), nil
}

func (f *fakeTSA) Check(token, digest []byte) (time.Time, error) {
	parts := strings.Split(string(token), "|")
	if len(parts) != 3 || parts[0] != "fake-tsa" {
		return time.Time{}, errors.New("not a fake-tsa token")
	}
	if parts[1] != hex.EncodeToString(digest) {
		return time.Time{}, errors.New("another hash")
	}
	return time.Parse(time.RFC3339, parts[2])
}

// Each seal is timestamped once; Verify checks them, and finds a seal that
// was rewritten (its stamp is of the old hash), one stamped again too late,
// and one left without a stamp past the grace. Days before stamping began
// may be stamped late: a later stamp, through the chain, covers them.
func TestStampAndVerify(t *testing.T) {
	trail := newMemTrail()
	d0 := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	*trail.events = []Row{
		row(d0.Add(9*time.Hour), "employee.created"),
		row(d0.Add(Day+9*time.Hour), "employee.updated"),
		row(d0.Add(2*Day+9*time.Hour), "employee.deleted"),
	}
	c := &clock{d0.Add(3*Day + 2*time.Hour)} // 4 Oct 02:00: 1–3 Oct can be sealed
	tsa := &fakeTSA{now: func() time.Time { return c.t }}
	from := d0.Add(Day) // stamping began with 2 Oct
	svc := NewService(trail, WithClock(c.now), WithTimestamps(tsa), WithStampsFrom(from))
	ctx := context.Background()

	if n, err := svc.SealDays(ctx); err != nil || n != 3 {
		t.Fatalf("sealed %d, %v", n, err)
	}
	if n, err := svc.StampDays(ctx); err != nil || n != 3 {
		t.Fatalf("stamped %d, %v; want every seal", n, err)
	}
	if n, _ := svc.StampDays(ctx); n != 0 {
		t.Errorf("stamped again: %d", n)
	}
	stamps := *trail.stamps
	if len(stamps) != 3 || stamps[0].TSA != "http://tsa.test" || !stamps[2].StampedAt.Equal(c.t) {
		t.Fatalf("stamps = %+v", stamps)
	}
	v, err := svc.Verify(ctx)
	if err != nil || !v.OK || v.Stamped != 3 || !v.LastStamped.Equal(d0.Add(2*Day)) || v.StampsWaiting != 0 {
		t.Fatalf("verify = %+v, %v", v, err)
	}

	// Someone with the database rewrites 2 Oct's event and seals again from there.
	honest := cloneSeals(*trail.seals)
	(*trail.events)[1].Event = "employee.created"
	*trail.seals = honest[:1]
	if _, err := svc.SealDays(ctx); err != nil {
		t.Fatal(err)
	}
	if v, _ := svc.Verify(ctx); v.OK || v.Mismatch.Problem != "stamp" || !v.Mismatch.Day.Equal(d0.Add(Day)) {
		t.Fatalf("a rewritten seal: %+v", v.Mismatch)
	}
	// ... and stamps the new seals again, a week and more later.
	c.t = c.t.Add(10 * Day)
	*trail.stamps = stamps[:1]
	if _, err := svc.StampDays(ctx); err != nil {
		t.Fatal(err)
	}
	if v, _ := svc.Verify(ctx); v.OK || v.Mismatch.Problem != "late" || !v.Mismatch.Day.Equal(d0.Add(Day)) {
		t.Fatalf("a seal stamped late: %+v", v.Mismatch)
	}
	// ... or leaves them without one.
	*trail.stamps = stamps[:1]
	if v, _ := svc.Verify(ctx); v.OK || v.Mismatch.Problem != "unstamped" {
		t.Fatalf("a seal without a stamp past the grace: %+v", v.Mismatch)
	}
}

// While the timestamp service does not answer, nothing is stored and the
// seals wait; after StampOverdue they are reported, before StampGrace fails them.
func TestStampsWaitWhileTheServiceIsDown(t *testing.T) {
	trail := newMemTrail()
	d0 := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	*trail.events = []Row{row(d0.Add(9*time.Hour), "employee.created")}
	c := &clock{d0.Add(Day + 2*time.Hour)}
	tsa := &fakeTSA{now: func() time.Time { return c.t }, down: true}
	svc := NewService(trail, WithClock(c.now), WithTimestamps(tsa), WithStampsFrom(d0))
	ctx := context.Background()
	if _, err := svc.SealDays(ctx); err != nil {
		t.Fatal(err)
	}
	if n, err := svc.StampDays(ctx); err == nil || n != 0 || len(*trail.stamps) != 0 {
		t.Fatalf("stamped %d, %v while the service is down", n, err)
	}
	if v, _ := svc.Verify(ctx); !v.OK || v.StampsWaiting != 1 || v.StampsOverdue != 0 {
		t.Fatalf("just sealed: %+v", v)
	}
	c.t = c.t.Add(Day)
	if v, _ := svc.Verify(ctx); !v.OK || v.StampsOverdue != 1 {
		t.Fatalf("a day later: %+v", v)
	}
	tsa.down = false
	if n, err := svc.StampDays(ctx); err != nil || n != 1 {
		t.Fatalf("back up: stamped %d, %v", n, err)
	}
	if v, _ := svc.Verify(ctx); !v.OK || v.Stamped != 1 || v.StampsWaiting != 0 {
		t.Fatalf("stamped within the grace: %+v", v)
	}
}

// Without timestamps nothing is stamped and Verify asks for none.
func TestNoTimestamps(t *testing.T) {
	trail := newMemTrail()
	d0 := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	*trail.events = []Row{row(d0.Add(9*time.Hour), "employee.created")}
	c := &clock{d0.Add(30 * Day)}
	svc := NewService(trail, WithClock(c.now), WithStampsFrom(d0))
	ctx := context.Background()
	if _, err := svc.SealDays(ctx); err != nil {
		t.Fatal(err)
	}
	if n, err := svc.StampDays(ctx); n != 0 || err != nil {
		t.Fatalf("stamped %d, %v", n, err)
	}
	if v, _ := svc.Verify(ctx); !v.OK || v.Stamped != 0 || v.StampsWaiting != 0 {
		t.Fatalf("verify = %+v", v)
	}
	if on, _ := svc.Timestamped(); on {
		t.Error("timestamps reported on")
	}
}

func cloneSeals(s []Seal) []Seal {
	out := make([]Seal, len(s))
	for i := range s {
		out[i] = s[i]
		out[i].Hash = bytes.Clone(s[i].Hash)
	}
	return out
}
