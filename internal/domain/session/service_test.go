package session

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/security"
)

// fakeRepo mirrors the Postgres repository in memory, keeping the security
// events it would write.
type fakeRepo struct {
	mu     sync.Mutex
	rows   map[uuid.UUID]Session
	events []security.Event
}

func newFakeRepo() *fakeRepo { return &fakeRepo{rows: map[uuid.UUID]Session{}} }

func (f *fakeRepo) Create(_ context.Context, s Session, ev security.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.rows[s.ID] = s
	f.events = append(f.events, ev)
	return nil
}

func (f *fakeRepo) Get(_ context.Context, id uuid.UUID) (Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.rows[id]
	if !ok {
		return Session{}, ErrNotFound
	}
	return s, nil
}

// kinds are the kinds of the events written so far, with their reasons.
func (f *fakeRepo) kinds() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, len(f.events))
	for i, ev := range f.events {
		out[i] = string(ev.Kind)
		if ev.Reason != "" {
			out[i] += ":" + ev.Reason
		}
	}
	return out
}

func (f *fakeRepo) Update(_ context.Context, id uuid.UUID, m Mutation) (Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cur, ok := f.rows[id]
	if !ok {
		return Session{}, ErrNotFound
	}
	next, ev, err := m(cur)
	if err != nil {
		return Session{}, err
	}
	f.rows[id] = next
	if ev != nil {
		f.events = append(f.events, *ev)
	}
	return next, nil
}

func (f *fakeRepo) ListLive(_ context.Context, userID uuid.UUID, now time.Time) ([]Session, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]Session, 0)
	for _, s := range f.rows {
		if s.UserID == userID && s.Live(now) {
			out = append(out, s)
		}
	}
	slices.SortFunc(out, func(a, b Session) int { return b.LastUsedAt.Compare(a.LastUsedAt) })
	return out, nil
}

func (f *fakeRepo) EndAll(_ context.Context, userID, keep uuid.UUID, at time.Time, reason string, record func(Session) security.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, s := range f.rows {
		if s.UserID == userID && id != keep && s.EndedAt == nil {
			s.EndedAt, s.EndReason = &at, reason
			f.rows[id] = s
			f.events = append(f.events, record(s))
		}
	}
	return nil
}

func (f *fakeRepo) Prune(_ context.Context, userID uuid.UUID, before time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, s := range f.rows {
		if s.UserID == userID && ((s.EndedAt != nil && s.EndedAt.Before(before)) || s.ExpiresAt.Before(before) || s.IdleExpiresAt.Before(before)) {
			delete(f.rows, id)
		}
	}
	return nil
}

var testLimits = Limits{MaxAge: 12 * time.Hour, KeepMaxAge: 30 * 24 * time.Hour, KeepIdle: 14 * 24 * time.Hour}

type clock struct{ t time.Time }

func (c *clock) now() time.Time          { return c.t }
func (c *clock) advance(d time.Duration) { c.t = c.t.Add(d) }
func newClock() *clock                   { return &clock{time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)} }
func newTestService(c *clock) (*Service, *fakeRepo) {
	repo := newFakeRepo()
	return NewService(repo, []byte(strings.Repeat("k", 32)), testLimits, WithClock(c.now)), repo
}

func TestStartLimits(t *testing.T) {
	c := newClock()
	svc, _ := newTestService(c)
	ctx := context.Background()
	user := uuid.New()

	kept, token, err := svc.Start(ctx, StartParams{UserID: user, KeepSignedIn: true, UserAgent: strings.Repeat("x", 1000), IP: "203.0.113.1"})
	if err != nil {
		t.Fatal(err)
	}
	if !kept.ExpiresAt.Equal(c.t.Add(30*24*time.Hour)) || !kept.IdleExpiresAt.Equal(c.t.Add(14*24*time.Hour)) {
		t.Errorf("kept: expires %v, idle %v", kept.ExpiresAt, kept.IdleExpiresAt)
	}
	if len(kept.UserAgent) != maxUserAgent || kept.IP != "203.0.113.1" || kept.Generation != 1 {
		t.Errorf("kept: user agent %d bytes, ip %q, generation %d", len(kept.UserAgent), kept.IP, kept.Generation)
	}
	if !strings.HasPrefix(token, kept.ID.String()+".1.") {
		t.Errorf("token = %q", token)
	}

	browser, _, err := svc.Start(ctx, StartParams{UserID: user})
	if err != nil {
		t.Fatal(err)
	}
	if !browser.ExpiresAt.Equal(c.t.Add(12*time.Hour)) || !browser.IdleExpiresAt.Equal(browser.ExpiresAt) {
		t.Errorf("without keep: expires %v, idle %v", browser.ExpiresAt, browser.IdleExpiresAt)
	}

	if _, _, err := svc.Start(ctx, StartParams{}); !errors.Is(err, ErrInvalid) {
		t.Errorf("no user: %v, want ErrInvalid", err)
	}
}

func TestRefreshRotates(t *testing.T) {
	c := newClock()
	svc, _ := newTestService(c)
	ctx := context.Background()
	s, t1, err := svc.Start(ctx, StartParams{UserID: uuid.New(), KeepSignedIn: true})
	if err != nil {
		t.Fatal(err)
	}

	c.advance(time.Hour)
	got, t2, err := svc.Refresh(ctx, t1, Seen{UserAgent: "Firefox", IP: "198.51.100.7"})
	if err != nil {
		t.Fatal(err)
	}
	if t2 == t1 || got.Generation != 2 || !got.LastUsedAt.Equal(c.t) || got.UserAgent != "Firefox" || got.IP != "198.51.100.7" {
		t.Fatalf("after refresh: generation %d, last used %v, %q %q", got.Generation, got.LastUsedAt, got.UserAgent, got.IP)
	}
	// The idle limit moves on; the absolute one does not.
	if !got.IdleExpiresAt.Equal(c.t.Add(14*24*time.Hour)) || !got.ExpiresAt.Equal(s.ExpiresAt) {
		t.Errorf("idle %v, expires %v", got.IdleExpiresAt, got.ExpiresAt)
	}

	// Within the grace, the replaced token gets the current one back, unchanged.
	c.advance(RotationGrace - time.Second)
	again, t2b, err := svc.Refresh(ctx, t1, Seen{})
	if err != nil || t2b != t2 || again.Generation != 2 {
		t.Fatalf("replaced token within grace: %v, same token %v, generation %d", err, t2b == t2, again.Generation)
	}
	// The current one rotates as usual.
	if _, t3, err := svc.Refresh(ctx, t2, Seen{}); err != nil || t3 == t2 {
		t.Fatalf("current token: %v", err)
	}
}

func TestRefreshReuseEndsTheSession(t *testing.T) {
	c := newClock()
	svc, repo := newTestService(c)
	ctx := context.Background()
	s, t1, _ := svc.Start(ctx, StartParams{UserID: uuid.New(), KeepSignedIn: true})
	_, t2, _ := svc.Refresh(ctx, t1, Seen{})

	// The replaced token after the grace: someone else has a copy.
	c.advance(RotationGrace + time.Second)
	if _, _, err := svc.Refresh(ctx, t1, Seen{}); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("reused token: %v, want ErrInvalidToken", err)
	}
	if got := repo.rows[s.ID]; got.EndedAt == nil || got.EndReason != ReasonReused {
		t.Fatalf("session after reuse: ended %v, reason %q", got.EndedAt, got.EndReason)
	}
	// Ended for the holder of the current token too.
	if _, _, err := svc.Refresh(ctx, t2, Seen{}); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("current token after reuse: %v, want ErrInvalidToken", err)
	}
}

func TestRefreshRefusals(t *testing.T) {
	c := newClock()
	svc, _ := newTestService(c)
	ctx := context.Background()
	user := uuid.New()
	kept, keptToken, _ := svc.Start(ctx, StartParams{UserID: user, KeepSignedIn: true})
	_, browserToken, _ := svc.Start(ctx, StartParams{UserID: user})
	other := uuid.New()
	forged := NewService(newFakeRepo(), []byte(strings.Repeat("z", 32)), testLimits).token(Session{ID: kept.ID, Seed: kept.Seed, Generation: 1})

	for name, raw := range map[string]string{
		"empty":        "",
		"garbage":      "a.b.c",
		"unknown":      other.String() + ".1.AAAA",
		"another key":  forged,
		"tampered":     keptToken[:len(keptToken)-2] + "AA",
		"generation 0": kept.ID.String() + ".0." + strings.Split(keptToken, ".")[2],
	} {
		if _, _, err := svc.Refresh(ctx, raw, Seen{}); !errors.Is(err, ErrInvalidToken) {
			t.Errorf("%s: %v, want ErrInvalidToken", name, err)
		}
	}

	// Without Keep me signed in: ends 12 hours after sign-in, used or not.
	c.advance(11 * time.Hour)
	_, browserToken, err := svc.Refresh(ctx, browserToken, Seen{})
	if err != nil {
		t.Fatal(err)
	}
	c.advance(time.Hour)
	if _, _, err := svc.Refresh(ctx, browserToken, Seen{}); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("12h after sign-in: %v, want ErrInvalidToken", err)
	}

	// With it: 14 days unused ends it.
	c.advance(14*24*time.Hour - 12*time.Hour)
	if _, _, err := svc.Refresh(ctx, keptToken, Seen{}); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("14 days unused: %v, want ErrInvalidToken", err)
	}
}

func TestKeptSessionEndsAfterMaxAge(t *testing.T) {
	c := newClock()
	svc, _ := newTestService(c)
	ctx := context.Background()
	_, token, _ := svc.Start(ctx, StartParams{UserID: uuid.New(), KeepSignedIn: true})
	// Used every 10 days, so never idle, until 30 days after sign-in.
	for range 2 {
		c.advance(10 * 24 * time.Hour)
		var err error
		if _, token, err = svc.Refresh(ctx, token, Seen{}); err != nil {
			t.Fatal(err)
		}
	}
	c.advance(10 * 24 * time.Hour)
	if _, _, err := svc.Refresh(ctx, token, Seen{}); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("30 days after sign-in: %v, want ErrInvalidToken", err)
	}
}

func TestSignOutAndEnd(t *testing.T) {
	c := newClock()
	svc, repo := newTestService(c)
	ctx := context.Background()
	user := uuid.New()
	a, ta, _ := svc.Start(ctx, StartParams{UserID: user, KeepSignedIn: true})
	b, _, _ := svc.Start(ctx, StartParams{UserID: user, KeepSignedIn: true})
	c3, tc, _ := svc.Start(ctx, StartParams{UserID: user, KeepSignedIn: true})

	if err := svc.SignOut(ctx, ta); err != nil {
		t.Fatal(err)
	}
	if got := repo.rows[a.ID]; got.EndReason != ReasonSignedOut {
		t.Errorf("signed out: reason %q", got.EndReason)
	}
	if err := svc.SignOut(ctx, ta); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("signing out twice: %v, want ErrInvalidToken", err)
	}

	// Another user cannot end b; its owner can.
	if err := svc.End(ctx, uuid.New(), b.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("someone else's session: %v, want ErrNotFound", err)
	}
	if err := svc.End(ctx, user, b.ID); err != nil {
		t.Fatal(err)
	}
	if got := repo.rows[b.ID]; got.EndReason != ReasonEndedElsewhere {
		t.Errorf("ended elsewhere: reason %q", got.EndReason)
	}
	live, _ := svc.List(ctx, user)
	if len(live) != 1 || live[0].ID != c3.ID {
		t.Fatalf("live = %v, want only the third", live)
	}
	if _, _, err := svc.Refresh(ctx, tc, Seen{}); err != nil {
		t.Errorf("the third still refreshes: %v", err)
	}
}

func TestEndAll(t *testing.T) {
	c := newClock()
	svc, repo := newTestService(c)
	ctx := context.Background()
	user, someone := uuid.New(), uuid.New()
	keep, _, _ := svc.Start(ctx, StartParams{UserID: user})
	gone, _, _ := svc.Start(ctx, StartParams{UserID: user})
	theirs, _, _ := svc.Start(ctx, StartParams{UserID: someone})

	if err := svc.EndAll(ctx, user, keep.ID, ReasonPasswordChanged); err != nil {
		t.Fatal(err)
	}
	if repo.rows[keep.ID].EndedAt != nil || repo.rows[theirs.ID].EndedAt != nil {
		t.Error("ended the kept session or another user's")
	}
	if repo.rows[gone.ID].EndReason != ReasonPasswordChanged {
		t.Errorf("reason = %q", repo.rows[gone.ID].EndReason)
	}
	if err := svc.EndAll(ctx, user, uuid.Nil, ReasonDeactivated); err != nil {
		t.Fatal(err)
	}
	if repo.rows[keep.ID].EndReason != ReasonDeactivated {
		t.Error("uuid.Nil kept a session")
	}
	if err := svc.EndAll(ctx, user, uuid.Nil, "bored"); !errors.Is(err, ErrInvalid) {
		t.Errorf("unknown reason: %v, want ErrInvalid", err)
	}
}

func TestReauthenticated(t *testing.T) {
	c := newClock()
	svc, _ := newTestService(c)
	ctx := context.Background()
	user := uuid.New()
	s, _, _ := svc.Start(ctx, StartParams{UserID: user, KeepSignedIn: true})
	c.advance(13 * time.Hour)
	got, err := svc.Reauthenticated(ctx, user, s.ID, nil)
	if err != nil || !got.AuthenticatedAt.Equal(c.t) || !got.CreatedAt.Equal(s.CreatedAt) {
		t.Fatalf("reauthenticated: %v, at %v", err, got.AuthenticatedAt)
	}
	if _, err := svc.Reauthenticated(ctx, uuid.New(), s.ID, nil); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user: %v, want ErrNotFound", err)
	}
	if g, err := svc.Get(ctx, user, s.ID); err != nil || g.ID != s.ID {
		t.Errorf("get: %v", err)
	}
}

func TestStartPrunesOldSessions(t *testing.T) {
	c := newClock()
	svc, repo := newTestService(c)
	ctx := context.Background()
	user := uuid.New()
	old, _, _ := svc.Start(ctx, StartParams{UserID: user})
	c.advance(31 * 24 * time.Hour)
	if _, _, err := svc.Start(ctx, StartParams{UserID: user}); err != nil {
		t.Fatal(err)
	}
	if _, ok := repo.rows[old.ID]; ok {
		t.Error("a session that expired over 30 days ago was kept")
	}
}

// Every way a session starts or ends records one security event, written with
// the session; a refresh that only rotates records none.
func TestSecurityEvents(t *testing.T) {
	c := newClock()
	svc, repo := newTestService(c)
	ctx := context.Background()
	user := uuid.New()
	hash := []byte(strings.Repeat("h", 32))

	a, ta, _ := svc.Start(ctx, StartParams{UserID: user, KeepSignedIn: true, EmailHash: hash})
	if ev := repo.events[0]; ev.Kind != security.KindSignIn || string(ev.EmailHash) != string(hash) ||
		*ev.UserID != user || *ev.SessionID != a.ID || !ev.OccurredAt.Equal(c.t) {
		t.Errorf("sign-in event = %+v", ev)
	}
	c.advance(time.Minute)
	_, ta2, _ := svc.Refresh(ctx, ta, Seen{})
	if _, err := svc.Reauthenticated(ctx, user, a.ID, hash); err != nil {
		t.Fatal(err)
	}
	if string(repo.events[1].EmailHash) != string(hash) {
		t.Error("the reauth event has no email hash")
	}
	if err := svc.SignOut(ctx, ta2); err != nil {
		t.Fatal(err)
	}

	_, tb, _ := svc.Start(ctx, StartParams{UserID: user})
	c.advance(time.Minute)
	_, tb2, _ := svc.Refresh(ctx, tb, Seen{})
	c.advance(RotationGrace + time.Second)
	_, _, _ = svc.Refresh(ctx, tb2, Seen{})
	if _, _, err := svc.Refresh(ctx, tb, Seen{}); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("reused token: %v", err)
	}

	d, _, _ := svc.Start(ctx, StartParams{UserID: user})
	if err := svc.EndByAdministrator(ctx, user, d.ID); err != nil {
		t.Fatal(err)
	}
	e, _, _ := svc.Start(ctx, StartParams{UserID: user})
	if err := svc.End(ctx, user, e.ID); err != nil {
		t.Fatal(err)
	}
	f, _, _ := svc.Start(ctx, StartParams{UserID: user})
	g, _, _ := svc.Start(ctx, StartParams{UserID: user})
	if err := svc.EndAll(ctx, user, g.ID, ReasonPasswordChanged); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"sign_in", "reauth", "signed_out",
		"sign_in", "refresh_reused",
		"sign_in", "session_ended:ended_by_administrator",
		"sign_in", "session_ended:ended_elsewhere",
		"sign_in", "sign_in", "session_ended:password_changed",
	}
	if got := repo.kinds(); !slices.Equal(got, want) {
		t.Errorf("events = %v\nwant %v", got, want)
	}
	last := repo.events[len(repo.events)-1]
	if *last.SessionID != f.ID || last.ID == uuid.Nil {
		t.Errorf("EndAll recorded %+v, want session %s", last, f.ID)
	}
}

func TestLive(t *testing.T) {
	c := newClock()
	svc, _ := newTestService(c)
	ctx := context.Background()
	s, _, _ := svc.Start(ctx, StartParams{UserID: uuid.New()})
	if got, err := svc.Live(ctx, s.ID); err != nil || got.ID != s.ID {
		t.Errorf("live: %v", err)
	}
	c.advance(13 * time.Hour)
	if _, err := svc.Live(ctx, s.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("expired: %v, want ErrNotFound", err)
	}
	if _, err := svc.Live(ctx, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown: %v, want ErrNotFound", err)
	}
}
