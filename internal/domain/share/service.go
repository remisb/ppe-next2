package share

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// The shared links' audit events (docs/specs/share-service.md, "Audit").
const (
	// EventCreated: a new link; its after is the kind, name, columns, the
	// number of rows, the records' ids and when it expires (no details).
	EventCreated = "share.created"
	// EventRevoked: the sharer revoked it; its before is the name and expiry.
	EventRevoked = "share.revoked"
	// Entity is the audit entity type of a link, keyed by its ID.
	Entity = "share"
)

// Service holds the shared links' use cases.
type Service struct {
	repo     Repository
	now      func() time.Time
	newID    func() uuid.UUID
	newToken func() (string, error)
}

// Option configures a Service.
type Option func(*Service)

// WithClock replaces the clock (UTC, microseconds, as Postgres stores them).
func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// NewService is the share service over repo.
func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{
		repo:     repo,
		now:      func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) },
		newID:    uuid.New,
		newToken: newToken,
	}
	for _, o := range opts {
		o(s)
	}
	return s
}

// newToken is a link's token: 32 random bytes, base64url without padding.
func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HashToken is the hex SHA-256 kept in shares.token_hash.
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Create is Share Link: it keeps p's rows behind a new token, open for
// p.Days, with share.created. The token is returned once and never stored.
func (s *Service) Create(ctx context.Context, p CreateParams, actor uuid.UUID) (Share, string, error) {
	if actor == uuid.Nil {
		return Share{}, "", fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Share{}, "", err
	}
	for _, r := range p.Rows {
		if !json.Valid(r) {
			return Share{}, "", fieldError("rows", "must be JSON")
		}
	}
	token, err := s.newToken()
	if err != nil {
		return Share{}, "", err
	}
	now := s.now()
	sh := Share{
		ID: s.newID(), Kind: p.Kind, Name: p.Name, Columns: p.Columns, SubjectIDs: p.SubjectIDs,
		Rows: p.Rows, RowCount: len(p.SubjectIDs), ExpiresAt: now.AddDate(0, 0, p.Days),
		CreatedAt: now, CreatedByUserID: actor, TokenHash: HashToken(token),
	}
	ev, err := audit.New(s.newID(), &actor, EventCreated, Entity, sh.ID, now, nil, map[string]any{
		"kind": sh.Kind, "name": sh.Name, "columns": sh.Columns, "rows": sh.RowCount,
		"subject_ids": sh.SubjectIDs, "expires_at": sh.ExpiresAt,
	})
	if err != nil {
		return Share{}, "", err
	}
	out, err := s.repo.Create(ctx, sh, ev)
	if err != nil {
		return Share{}, "", err
	}
	return out, token, nil
}

// List is Shared Links: actor's links still open, newest first.
func (s *Service) List(ctx context.Context, actor uuid.UUID) ([]Share, error) {
	return s.repo.ListOpen(ctx, actor, s.now())
}

// Revoke closes actor's open link at once and erases its rows, with
// share.revoked. Another's link, or one no longer open, is ErrNotFound.
func (s *Service) Revoke(ctx context.Context, id, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	_, err := s.repo.Update(ctx, id, func(cur Share) (Share, []audit.Event, error) {
		now := s.now()
		if cur.CreatedByUserID != actor || !cur.Open(now) {
			return cur, nil, ErrNotFound
		}
		next := cur
		next.RevokedAt, next.RevokedByUserID, next.ErasedAt = &now, &actor, &now
		next.Rows = []json.RawMessage{}
		ev, err := audit.New(s.newID(), &actor, EventRevoked, Entity, cur.ID, now,
			map[string]any{"name": cur.Name, "expires_at": cur.ExpiresAt}, nil)
		if err != nil {
			return cur, nil, err
		}
		return next, []audit.Event{ev}, nil
	})
	return err
}

// Open is the public page's read of a link by its token: ErrNotFound for an
// unknown token, ErrGone once it is revoked or expired.
func (s *Service) Open(ctx context.Context, token string) (Share, error) {
	if token == "" {
		return Share{}, ErrNotFound
	}
	sh, err := s.repo.ByTokenHash(ctx, HashToken(token))
	if err != nil {
		return Share{}, err
	}
	if !sh.Open(s.now()) {
		return Share{}, ErrGone
	}
	return sh, nil
}

// EraseExpired empties the rows of every expired link (the upkeep's).
func (s *Service) EraseExpired(ctx context.Context) (int, error) {
	return s.repo.EraseExpired(ctx, s.now())
}
