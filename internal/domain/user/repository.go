package user

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Repository is the persistence the user service needs. Implementations only
// read and write rows; they translate storage errors into this package's
// sentinels and never validate or invent values.
type Repository interface {
	Create(ctx context.Context, u User) error
	Get(ctx context.Context, id uuid.UUID) (User, error)
	// ByEmail matches case-insensitively among live users.
	ByEmail(ctx context.Context, email string) (User, error)
	List(ctx context.Context) ([]User, error)
	// Update writes email, name, roles, is_active, updated_at and updated_by.
	Update(ctx context.Context, u User) error
	SetPasswordHash(ctx context.Context, id uuid.UUID, hash string, at time.Time, by uuid.UUID) error
	Delete(ctx context.Context, id uuid.UUID, at time.Time, by uuid.UUID) error
}
