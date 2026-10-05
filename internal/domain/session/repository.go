package session

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Mutation receives a session under a row lock and returns what to write.
// When it returns an error nothing is written.
type Mutation func(cur Session) (Session, error)

// Repository is the persistence the session service needs.
type Repository interface {
	Create(ctx context.Context, s Session) error
	// Update locks session id, calls m and writes generation, rotated_at,
	// authenticated_at, last_used_at, idle_expires_at, ended_at, end_reason,
	// user_agent and ip from its result, in one transaction. ErrNotFound if
	// there is no such session.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Session, error)
	// ListLive returns userID's sessions live at now, last used first.
	ListLive(ctx context.Context, userID uuid.UUID, now time.Time) ([]Session, error)
	// EndAll ends userID's sessions not yet ended, except keep.
	EndAll(ctx context.Context, userID, keep uuid.UUID, at time.Time, reason string) error
	// Prune deletes userID's sessions that ended or expired before before.
	Prune(ctx context.Context, userID uuid.UUID, before time.Time) error
}
