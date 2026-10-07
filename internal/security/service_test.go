package security

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// fakeStore keeps events in memory and answers Failures as the Postgres
// store does.
type fakeStore struct {
	events   []Event
	review   ReviewData
	reviewed []audit.Event
	purged   time.Time
}

func (f *fakeStore) Insert(_ context.Context, ev Event) error {
	f.events = append(f.events, ev)
	return nil
}
func (f *fakeStore) List(context.Context, Query) ([]Entry, error) { return nil, nil }
func (f *fakeStore) Failures(_ context.Context, hash []byte, since time.Time, limit int) ([]time.Time, error) {
	var out []time.Time
	for i := len(f.events) - 1; i >= 0 && len(out) < limit; i-- {
		ev := f.events[i]
		if string(ev.EmailHash) != string(hash) || !ev.OccurredAt.After(since) {
			continue
		}
		if ev.Kind == KindSignIn || ev.Kind == KindReauth {
			break
		}
		if slices.Contains(failureReasons, ev.Reason) {
			out = append(out, ev.OccurredAt)
		}
	}
	return out, nil
}
func (f *fakeStore) LiveSessions(context.Context, time.Time) ([]LiveSession, error) { return nil, nil }
func (f *fakeStore) Review(context.Context, time.Time) (ReviewData, error) {
	data := f.review
	data.Users = slices.Clone(data.Users)
	return data, nil
}
func (f *fakeStore) Reviewed(_ context.Context, ev audit.Event) error {
	f.reviewed = append(f.reviewed, ev)
	at := ev.OccurredAt
	f.review.LastReview = &LastReview{At: at, ByID: ev.ActorUserID, EventID: ev.ID}
	return nil
}
func (f *fakeStore) Purge(_ context.Context, before time.Time) (int64, error) {
	f.purged = before
	return 0, nil
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newTestService(cfg Config) (*Service, *fakeStore, *clock) {
	c := &clock{time.Date(2026, 10, 7, 9, 0, 0, 0, time.UTC)}
	store := &fakeStore{}
	if cfg.Key == nil {
		cfg.Key = []byte(strings.Repeat("k", 32))
	}
	return NewService(store, cfg, WithClock(c.now)), store, c
}

// Failed attempts at one email within the interval since its last success
// refuse it until the oldest of them leaves the window; refusals by the limit
// itself do not count, and a success starts the count again.
func TestBlocked(t *testing.T) {
	svc, store, c := newTestService(Config{Failures: 3, Interval: 15 * time.Minute})
	ctx := context.Background()
	ana, bob := svc.EmailHash("ana@example.com"), svc.EmailHash("bob@example.com")
	fail := func(hash []byte) {
		t.Helper()
		if err := svc.Refused(ctx, KindSignInFailed, hash, uuid.Nil, ReasonBadPassword); err != nil {
			t.Fatal(err)
		}
	}
	blocked := func(hash []byte) time.Duration {
		t.Helper()
		wait, err := svc.Blocked(ctx, hash)
		if err != nil {
			t.Fatal(err)
		}
		return wait
	}

	fail(ana)
	c.advance(time.Minute)
	fail(ana)
	if blocked(ana) != 0 {
		t.Fatal("blocked after two failures")
	}
	c.advance(time.Minute)
	fail(ana)
	if got := blocked(ana); got != 13*time.Minute {
		t.Errorf("wait = %v, want 13m (until the first failure leaves the window)", got)
	}
	if blocked(bob) != 0 {
		t.Error("another email is blocked")
	}
	// Refusals while blocked do not extend the block.
	if err := svc.Refused(ctx, KindSignInFailed, ana, uuid.Nil, ReasonTooManyAttempts); err != nil {
		t.Fatal(err)
	}
	c.advance(13 * time.Minute)
	if got := blocked(ana); got != 0 {
		t.Errorf("still blocked %v after the first failure left the window", got)
	}

	// A success clears the failures before it.
	fail(ana)
	store.events = append(store.events, Event{Kind: KindSignIn, EmailHash: ana, OccurredAt: c.t})
	c.advance(time.Second)
	fail(ana)
	if blocked(ana) != 0 {
		t.Error("failures before a success still count")
	}

	off, _, _ := newTestService(Config{})
	if wait, err := off.Blocked(ctx, ana); wait != 0 || err != nil {
		t.Errorf("limit off: %v, %v", wait, err)
	}
}

func TestRefusedChecksWhatItRecords(t *testing.T) {
	svc, store, _ := newTestService(Config{})
	ctx := context.Background()
	if err := svc.Refused(ctx, KindSignIn, nil, uuid.Nil, ReasonBadPassword); !errors.Is(err, ErrInvalid) {
		t.Errorf("a success as a failure: %v", err)
	}
	if err := svc.Refused(ctx, KindSignInFailed, nil, uuid.Nil, "bored"); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown reason: %v", err)
	}
	user := uuid.New()
	if err := svc.Refused(ctx, KindReauthFailed, []byte("h"), user, ReasonBadPassword); err != nil {
		t.Fatal(err)
	}
	if ev := store.events[0]; ev.UserID == nil || *ev.UserID != user || ev.ID == uuid.Nil || ev.Kind != KindReauthFailed {
		t.Errorf("recorded %+v", ev)
	}
}

func TestEmailHashIsKeyed(t *testing.T) {
	a, _, _ := newTestService(Config{Key: []byte(strings.Repeat("a", 32))})
	b, _, _ := newTestService(Config{Key: []byte(strings.Repeat("b", 32))})
	if string(a.EmailHash("x@example.com")) == string(b.EmailHash("x@example.com")) {
		t.Error("two keys give the same hash")
	}
	if string(a.EmailHash(" X@Example.com ")) != string(a.EmailHash("x@example.com")) || len(a.EmailHash("x")) != 32 {
		t.Error("the hash does not compare emails as accounts do")
	}
}

func TestListFilters(t *testing.T) {
	svc, _, _ := newTestService(Config{})
	ctx := context.Background()
	for name, f := range map[string]Filter{
		"unknown kind":   {Kind: "hack"},
		"page too big":   {PageSize: 201},
		"bad date":       {FromDate: "7.10.2026"},
		"to before from": {FromDate: "2026-10-07", ToDate: "2026-10-06"},
	} {
		if _, err := svc.List(ctx, f); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v, want ErrInvalid", name, err)
		}
	}
	page, err := svc.List(ctx, Filter{Kind: KindSignInFailed, FromDate: "2026-10-07", ToDate: "2026-10-07"})
	if err != nil || page.Events == nil || page.Next != nil {
		t.Errorf("empty page = %+v, %v", page, err)
	}
}

// The review flags administrators, accounts with no sign-in recorded and
// active ones unused for 90 days; Mark as reviewed records how many of each.
func TestReview(t *testing.T) {
	svc, store, c := newTestService(Config{})
	ctx := context.Background()
	admin := "admin"
	recent := c.t.Add(-24 * time.Hour)
	old := c.t.Add(-100 * 24 * time.Hour)
	store.review = ReviewData{Users: []ReviewUser{
		{Name: "Admin", IsActive: true, CreatedAt: old, LastSignInAt: &recent, Roles: []ReviewRole{{Key: &admin}}},
		{Name: "Dormant", IsActive: true, CreatedAt: old, LastSignInAt: &old},
		{Name: "New", IsActive: true, CreatedAt: recent},
		{Name: "Never, old", IsActive: true, CreatedAt: old},
		{Name: "Off", IsActive: false, CreatedAt: old, LastSignInAt: &old},
	}}
	r, err := svc.Review(ctx)
	if err != nil {
		t.Fatal(err)
	}
	want := [][]string{
		{FlagAdministrator}, {FlagDormant}, {FlagNoSignIn}, {FlagNoSignIn, FlagDormant}, {},
	}
	for i, u := range r.Users {
		if !slices.Equal(u.Flags, want[i]) {
			t.Errorf("%s: flags %v, want %v", u.Name, u.Flags, want[i])
		}
	}
	if r.DormantAfterDays != 90 || r.UnusedRoles == nil || r.LastReview != nil {
		t.Errorf("review = %+v", r)
	}

	if _, err := svc.MarkReviewed(ctx, uuid.Nil); !errors.Is(err, ErrInvalid) {
		t.Errorf("no actor: %v", err)
	}
	actor := uuid.New()
	r, err = svc.MarkReviewed(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	ev := store.reviewed[0]
	if ev.Event != EventAccessReviewCompleted || ev.EntityType != "access_review" || *ev.ActorUserID != actor || ev.Before != nil {
		t.Errorf("recorded %+v", ev)
	}
	var got summary
	if err := json.Unmarshal(ev.After, &got); err != nil {
		t.Fatal(err)
	}
	if got != (summary{Users: 5, ActiveUsers: 4, Administrators: 1, Dormant: 2, NoSignIn: 2}) {
		t.Errorf("summary = %+v", got)
	}
	if r.LastReview == nil || *r.LastReview.ByID != actor {
		t.Errorf("last review = %+v", r.LastReview)
	}
	if audit.AreaOf("access_review") != audit.AreaSecurity || !audit.IsEvent(EventAccessReviewCompleted) {
		t.Error("the audit log does not know the access review")
	}
}

func TestPurge(t *testing.T) {
	svc, store, c := newTestService(Config{Retention: 180 * 24 * time.Hour})
	if _, err := svc.Purge(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !store.purged.Equal(c.t.Add(-180 * 24 * time.Hour)) {
		t.Errorf("purged before %v", store.purged)
	}
	off, store, _ := newTestService(Config{})
	if _, err := off.Purge(context.Background()); err != nil || !store.purged.IsZero() {
		t.Error("no retention purged")
	}
}

// The web's list of kinds, which its words are typed against, is this one.
func TestWebClientListsTheKinds(t *testing.T) {
	src, err := os.ReadFile("../../web/packages/api-client/src/security.ts")
	if err != nil {
		t.Fatal(err)
	}
	list := regexp.MustCompile(`(?s)SECURITY_KINDS = \[(.*?)\] as const`).FindSubmatch(src)
	if list == nil {
		t.Fatal("no SECURITY_KINDS list in security.ts")
	}
	var web []string
	for _, m := range regexp.MustCompile(`'([^']+)'`).FindAllSubmatch(list[1], -1) {
		web = append(web, string(m[1]))
	}
	var kinds []string
	for _, k := range Kinds() {
		kinds = append(kinds, string(k))
	}
	if !slices.Equal(web, kinds) {
		t.Errorf("security.ts lists %v, Go %v", web, kinds)
	}
}
