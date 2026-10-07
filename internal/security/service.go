package security

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Store is the security log's persistence. Implementations translate storage
// errors and never validate: Service checks everything first.
type Store interface {
	// Insert writes ev on its own (Insert, in a transaction of its own).
	Insert(ctx context.Context, ev Event) error
	// List returns up to q.Limit events matching q, newest first.
	List(ctx context.Context, q Query) ([]Entry, error)
	// Failures returns when emailHash's counted failures happened (reasons
	// failureReasons) after since and after its last sign_in or reauth,
	// newest first, at most limit.
	Failures(ctx context.Context, emailHash []byte, since time.Time, limit int) ([]time.Time, error)
	// LiveSessions lists every live user's sessions live at now, last used first.
	LiveSessions(ctx context.Context, now time.Time) ([]LiveSession, error)
	// Review reads the access review's users, unused roles and last review.
	Review(ctx context.Context, now time.Time) (ReviewData, error)
	// Reviewed records ev, the access_review.completed audit event.
	Reviewed(ctx context.Context, ev audit.Event) error
	// Summary counts what the Overview shows, at now; dayStart begins today
	// in the organisation's timezone.
	Summary(ctx context.Context, now, dayStart time.Time) (Summary, error)
	// Purge deletes the events that occurred before before, unless another
	// instance is purging now (then 0). It returns how many it deleted.
	Purge(ctx context.Context, before time.Time) (int64, error)
}

// Config is the service's policy, from the API's configuration.
type Config struct {
	// Key keys the email hash (at least 32 bytes, kept secret).
	Key []byte
	// Failures failed attempts at one email within Interval since its last
	// success refuse it until the oldest leaves the window. 0 switches the
	// per-email limit off (tests that build a config by hand).
	Failures int
	Interval time.Duration
	// Retention is how long events are kept (Purge).
	Retention time.Duration
}

// Service is the security log's read side, the per-email sign-in limit, the
// access review and the purge.
type Service struct {
	store Store
	cfg   Config
	loc   *time.Location
	now   func() time.Time
	newID func() uuid.UUID
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// WithLocation sets the organisation's timezone, in which from and to are
// calendar days. The default is UTC.
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

func NewService(store Store, cfg Config, opts ...Option) *Service {
	s := &Service{
		store: store,
		cfg:   cfg,
		loc:   time.UTC,
		now:   func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) },
		newID: uuid.New,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// EmailHash is how the log names the email an attempt typed: an HMAC-SHA256 of
// it, trimmed and lower-cased as accounts compare, under the configured key.
func (s *Service) EmailHash(email string) []byte {
	h := hmac.New(sha256.New, s.cfg.Key)
	h.Write([]byte(strings.ToLower(strings.TrimSpace(email))))
	return h.Sum(nil)
}

// Blocked reports how long emailHash is still refused by the per-email limit;
// 0 when it is not. Only failures since the email's last success count, so a
// user who signs in normally is never limited.
func (s *Service) Blocked(ctx context.Context, emailHash []byte) (time.Duration, error) {
	if s.cfg.Failures < 1 {
		return 0, nil
	}
	now := s.now()
	times, err := s.store.Failures(ctx, emailHash, now.Add(-s.cfg.Interval), s.cfg.Failures)
	if err != nil || len(times) < s.cfg.Failures {
		return 0, err
	}
	// The oldest of the last Failures failures: once it leaves the window,
	// fewer than Failures remain.
	if wait := times[s.cfg.Failures-1].Add(s.cfg.Interval).Sub(now); wait > 0 {
		return wait, nil
	}
	return 0, nil
}

// Refused records a failed sign-in or reauth: kind KindSignInFailed or
// KindReauthFailed, the account when the email named one, and why.
func (s *Service) Refused(ctx context.Context, kind Kind, emailHash []byte, userID uuid.UUID, reason string) error {
	if kind != KindSignInFailed && kind != KindReauthFailed {
		return fieldError("kind", "is not a failure")
	}
	if reason != ReasonTooManyAttempts && !slices.Contains(failureReasons, reason) {
		return fieldError("reason", "is not known")
	}
	ev := Event{ID: s.newID(), OccurredAt: s.now(), Kind: kind, EmailHash: emailHash, Reason: reason}
	if userID != uuid.Nil {
		ev.UserID = &userID
	}
	return s.store.Insert(ctx, ev)
}

// List is one page of the security log, newest first.
func (s *Service) List(ctx context.Context, f Filter) (Page, error) {
	q, err := f.resolve(s.loc)
	if err != nil {
		return Page{}, err
	}
	limit := q.Limit
	q.Limit++
	rows, err := s.store.List(ctx, q)
	if err != nil {
		return Page{}, err
	}
	page := Page{Events: rows}
	if len(rows) > limit {
		page.Events = rows[:limit]
		last := page.Events[limit-1]
		next := audit.Cursor{At: last.OccurredAt, ID: last.ID}.String()
		page.Next = &next
	}
	if page.Events == nil {
		page.Events = make([]Entry, 0)
	}
	return page, nil
}

// Sessions are every user's live sessions, last used first.
func (s *Service) Sessions(ctx context.Context) ([]LiveSession, error) {
	out, err := s.store.LiveSessions(ctx, s.now())
	if out == nil && err == nil {
		out = make([]LiveSession, 0)
	}
	return out, err
}

// Review is the access review, with each user's flags.
func (s *Service) Review(ctx context.Context) (Review, error) {
	now := s.now()
	data, err := s.store.Review(ctx, now)
	if err != nil {
		return Review{}, err
	}
	out := Review{
		Users: data.Users, UnusedRoles: data.UnusedRoles, LastReview: data.LastReview,
		DormantAfterDays: int(DormantAfter / (24 * time.Hour)),
	}
	if out.Users == nil {
		out.Users = make([]ReviewUser, 0)
	}
	if out.UnusedRoles == nil {
		out.UnusedRoles = make([]ReviewRole, 0)
	}
	for i := range out.Users {
		out.Users[i].Flags = flags(out.Users[i], now)
	}
	return out, nil
}

// flags are what the review points out about u at now.
func flags(u ReviewUser, now time.Time) []string {
	out := make([]string, 0)
	if slices.ContainsFunc(u.Roles, func(r ReviewRole) bool { return r.Key != nil && *r.Key == "admin" }) {
		out = append(out, FlagAdministrator)
	}
	if u.LastSignInAt == nil {
		out = append(out, FlagNoSignIn)
	}
	since := u.CreatedAt
	if u.LastSignInAt != nil {
		since = *u.LastSignInAt
	}
	if u.IsActive && now.Sub(since) >= DormantAfter {
		out = append(out, FlagDormant)
	}
	return out
}

// MarkReviewed records that actor has reviewed access now, with how many
// accounts carried each flag, and returns the review as it now stands.
func (s *Service) MarkReviewed(ctx context.Context, actor uuid.UUID) (Review, error) {
	if actor == uuid.Nil {
		return Review{}, fieldError("actor", "is required")
	}
	cur, err := s.Review(ctx)
	if err != nil {
		return Review{}, err
	}
	id := s.newID()
	ev, err := audit.New(s.newID(), &actor, EventAccessReviewCompleted, "access_review", id, s.now(), nil, summarise(cur.Users))
	if err != nil {
		return Review{}, err
	}
	if err := s.store.Reviewed(ctx, ev); err != nil {
		return Review{}, err
	}
	return s.Review(ctx)
}

// Summary is the security log's figures for the Overview, at now.
func (s *Service) Summary(ctx context.Context) (Summary, error) {
	now := s.now()
	local := now.In(s.loc)
	day := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, s.loc)
	return s.store.Summary(ctx, now, day)
}

// Purge deletes the events older than the retention, returning how many.
func (s *Service) Purge(ctx context.Context) (int64, error) {
	if s.cfg.Retention <= 0 {
		return 0, nil
	}
	return s.store.Purge(ctx, s.now().Add(-s.cfg.Retention))
}
