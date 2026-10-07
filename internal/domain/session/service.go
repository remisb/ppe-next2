package session

import (
	"context"
	"crypto/rand"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/security"
)

// RotationGrace is how long after a refresh the token it replaced still
// works, answered with the current token rather than a new one: a second tab
// that refreshed at the same moment, or a reply that never arrived, gets the
// current token instead of ending the sign-in as a reused token would.
const RotationGrace = 2 * time.Minute

// keepEnded is how long ended and expired sessions stay in the table before
// a later sign-in by the same user deletes them.
const keepEnded = 30 * 24 * time.Hour

// Service owns session policy: limits, rotation and reuse detection.
type Service struct {
	repo   Repository
	key    []byte
	limits Limits
	now    func() time.Time
	newID  func() uuid.UUID
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// NewService keeps sessions in repo, signing their tokens with key (at least
// 32 bytes, kept secret like the JWT secret).
func NewService(repo Repository, key []byte, limits Limits, opts ...Option) *Service {
	s := &Service{
		repo:   repo,
		key:    key,
		limits: limits,
		now:    func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) },
		newID:  uuid.New,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Start records a sign-in and returns it with its first refresh token.
func (s *Service) Start(ctx context.Context, p StartParams) (Session, string, error) {
	if p.UserID == uuid.Nil {
		return Session{}, "", fieldError("user_id", "is required")
	}
	seen := Seen{UserAgent: p.UserAgent, IP: p.IP}.normalize()
	seed := make([]byte, 32)
	if _, err := rand.Read(seed); err != nil {
		return Session{}, "", err
	}
	now := s.now()
	cur := Session{
		ID:              s.newID(),
		UserID:          p.UserID,
		Seed:            seed,
		Generation:      1,
		RotatedAt:       now,
		KeepSignedIn:    p.KeepSignedIn,
		CreatedAt:       now,
		AuthenticatedAt: now,
		LastUsedAt:      now,
		UserAgent:       seen.UserAgent,
		IP:              seen.IP,
	}
	if p.KeepSignedIn {
		cur.ExpiresAt = now.Add(s.limits.KeepMaxAge)
	} else {
		cur.ExpiresAt = now.Add(s.limits.MaxAge)
	}
	cur.IdleExpiresAt = s.idleUntil(cur, now)
	if err := s.repo.Prune(ctx, p.UserID, now.Add(-keepEnded)); err != nil {
		return Session{}, "", err
	}
	ev := s.event(security.KindSignIn, cur, "", now)
	ev.EmailHash = p.EmailHash
	if err := s.repo.Create(ctx, cur, ev); err != nil {
		return Session{}, "", err
	}
	return cur, s.token(cur), nil
}

// event is the security event kind for session cur at now, with reason.
func (s *Service) event(kind security.Kind, cur Session, reason string, now time.Time) security.Event {
	return security.Event{
		ID: s.newID(), OccurredAt: now, Kind: kind, UserID: &cur.UserID, SessionID: &cur.ID, Reason: reason,
	}
}

// idleUntil is when cur ends if unused from now: a session without Keep me
// signed in has no idle limit of its own (its cookie ends with the browser).
func (s *Service) idleUntil(cur Session, now time.Time) time.Time {
	if !cur.KeepSignedIn {
		return cur.ExpiresAt
	}
	if idle := now.Add(s.limits.KeepIdle); idle.Before(cur.ExpiresAt) {
		return idle
	}
	return cur.ExpiresAt
}

// Refresh takes the browser's refresh token and returns the session with the
// token to keep. The current token is replaced by the next one. The one it
// replaced, within RotationGrace, gets the current token again. Any other
// token whose mac checks out is a copy used after it was replaced, so the
// session ends (ReasonReused). Every refusal is ErrInvalidToken.
func (s *Service) Refresh(ctx context.Context, raw string, seen Seen) (Session, string, error) {
	id, generation, mac, err := parseToken(raw)
	if err != nil {
		return Session{}, "", err
	}
	seen = seen.normalize()
	now := s.now()
	reused := false
	cur, err := s.repo.Update(ctx, id, func(cur Session) (Session, *security.Event, error) {
		if !s.matches(cur, generation, mac) || !cur.Live(now) {
			return cur, nil, ErrInvalidToken
		}
		switch {
		case generation == cur.Generation:
			cur.Generation++
			cur.RotatedAt = now
		case generation == cur.Generation-1 && now.Sub(cur.RotatedAt) <= RotationGrace:
			// Send the current token again.
		default:
			reused = true
			cur.EndedAt, cur.EndReason = &now, ReasonReused
			ev := s.event(security.KindRefreshReused, cur, "", now)
			return cur, &ev, nil
		}
		cur.LastUsedAt = now
		cur.IdleExpiresAt = s.idleUntil(cur, now)
		cur.UserAgent, cur.IP = seen.UserAgent, seen.IP
		return cur, nil, nil
	})
	switch {
	case errors.Is(err, ErrNotFound):
		return Session{}, "", ErrInvalidToken
	case err != nil:
		return Session{}, "", err
	case reused:
		return Session{}, "", ErrInvalidToken
	}
	return cur, s.token(cur), nil
}

// SignOut ends the session raw belongs to. A token that is not the current
// one or the one it just replaced, or a session already ended, is
// ErrInvalidToken, and nothing changes.
func (s *Service) SignOut(ctx context.Context, raw string) error {
	id, generation, mac, err := parseToken(raw)
	if err != nil {
		return err
	}
	now := s.now()
	_, err = s.repo.Update(ctx, id, func(cur Session) (Session, *security.Event, error) {
		current := generation == cur.Generation || generation == cur.Generation-1
		if !current || !s.matches(cur, generation, mac) || cur.EndedAt != nil {
			return cur, nil, ErrInvalidToken
		}
		cur.EndedAt, cur.EndReason = &now, ReasonSignedOut
		ev := s.event(security.KindSignedOut, cur, "", now)
		return cur, &ev, nil
	})
	if errors.Is(err, ErrNotFound) {
		return ErrInvalidToken
	}
	return err
}

// Get returns userID's session id while it is live, or ErrNotFound.
func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (Session, error) {
	live, err := s.repo.ListLive(ctx, userID, s.now())
	if err != nil {
		return Session{}, err
	}
	i := slices.IndexFunc(live, func(x Session) bool { return x.ID == id })
	if i < 0 {
		return Session{}, ErrNotFound
	}
	return live[i], nil
}

// Live returns session id while it is live, whoever's it is, or ErrNotFound.
func (s *Service) Live(ctx context.Context, id uuid.UUID) (Session, error) {
	cur, err := s.repo.Get(ctx, id)
	if err != nil {
		return Session{}, err
	}
	if !cur.Live(s.now()) {
		return Session{}, ErrNotFound
	}
	return cur, nil
}

// Reauthenticated records that userID entered their password again in
// session id, and returns the session. emailHash is their email's
// (security.Service.EmailHash): the success clears its failures.
func (s *Service) Reauthenticated(ctx context.Context, userID, id uuid.UUID, emailHash []byte) (Session, error) {
	now := s.now()
	return s.repo.Update(ctx, id, func(cur Session) (Session, *security.Event, error) {
		if cur.UserID != userID || !cur.Live(now) {
			return cur, nil, ErrNotFound
		}
		cur.AuthenticatedAt = now
		ev := s.event(security.KindReauth, cur, "", now)
		ev.EmailHash = emailHash
		return cur, &ev, nil
	})
}

// End ends one of userID's live sessions from another device's list.
func (s *Service) End(ctx context.Context, userID, id uuid.UUID) error {
	return s.end(ctx, userID, id, ReasonEndedElsewhere)
}

// EndByAdministrator ends userID's live session id from Administration. The
// caller checks that the administrator may manage userID.
func (s *Service) EndByAdministrator(ctx context.Context, userID, id uuid.UUID) error {
	return s.end(ctx, userID, id, ReasonEndedByAdministrator)
}

func (s *Service) end(ctx context.Context, userID, id uuid.UUID, reason string) error {
	now := s.now()
	_, err := s.repo.Update(ctx, id, func(cur Session) (Session, *security.Event, error) {
		if cur.UserID != userID || !cur.Live(now) {
			return cur, nil, ErrNotFound
		}
		cur.EndedAt, cur.EndReason = &now, reason
		ev := s.event(security.KindSessionEnded, cur, reason, now)
		return cur, &ev, nil
	})
	return err
}

// EndAll ends every session of userID except keep (uuid.Nil keeps none),
// recording reason.
func (s *Service) EndAll(ctx context.Context, userID, keep uuid.UUID, reason string) error {
	if userID == uuid.Nil {
		return fieldError("user_id", "is required")
	}
	if !slices.Contains(reasons, reason) {
		return fieldError("reason", "is unknown")
	}
	now := s.now()
	return s.repo.EndAll(ctx, userID, keep, now, reason, func(ended Session) security.Event {
		return s.event(security.KindSessionEnded, ended, reason, now)
	})
}

// List returns userID's live sessions, last used first.
func (s *Service) List(ctx context.Context, userID uuid.UUID) ([]Session, error) {
	return s.repo.ListLive(ctx, userID, s.now())
}
