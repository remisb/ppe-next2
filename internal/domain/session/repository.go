package session

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/security"
)

// Mutation receives a session under a row lock and returns what to write,
// with the security event to record beside it (nil for none). When it returns
// an error nothing is written.
type Mutation func(cur Session) (Session, *security.Event, error)

// Repository is the persistence the session service needs. Every write
// records its security events (internal/security) in the same transaction.
type Repository interface {
	// Create writes s and ev (its sign_in), and sets the user's
	// last_sign_in_at to s.CreatedAt.
	Create(ctx context.Context, s Session, ev security.Event) error
	// Get returns session id, ended or not, or ErrNotFound.
	Get(ctx context.Context, id uuid.UUID) (Session, error)
	// Update locks session id, calls m and writes generation, rotated_at,
	// authenticated_at, last_used_at, idle_expires_at, ended_at, end_reason,
	// user_agent and ip from its result, and its event, in one transaction.
	// ErrNotFound if there is no such session.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Session, error)
	// ListLive returns userID's sessions live at now, last used first.
	ListLive(ctx context.Context, userID uuid.UUID, now time.Time) ([]Session, error)
	// EndAll ends userID's sessions not yet ended, except keep, recording
	// record(s) for each one it ends.
	EndAll(ctx context.Context, userID, keep uuid.UUID, at time.Time, reason string, record func(Session) security.Event) error
	// Prune deletes userID's sessions that ended or expired before before.
	Prune(ctx context.Context, userID uuid.UUID, before time.Time) error
}
