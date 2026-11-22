package company

import (
	"context"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes a company's new state from its current, locked state
// plus the audit events to record (none for none).
type Mutation func(cur Company) (Company, []audit.Event, error)

// Repository is the persistence the company service needs. Its reads return
// live companies only (a deleted one is ErrNotFound), each with its current
// employees counted. Implementations translate storage errors to this
// package's sentinels and never validate.
type Repository interface {
	// Create stores c and ev in one transaction and returns c as read back; a
	// live company's code is ErrCodeTaken, and c marked the default while
	// another live company is it ErrDefaultTaken.
	Create(ctx context.Context, c Company, ev audit.Event) (Company, error)
	// Get is the live company, or ErrNotFound.
	Get(ctx context.Context, id uuid.UUID) (Company, error)
	// Default is the live default company, or ErrNotFound.
	Default(ctx context.Context) (Company, error)
	// List returns every live company, the default first, then by name.
	List(ctx context.Context) ([]Company, error)
	// Update locks the live company (ErrNotFound), applies m and, when m
	// returns events, writes the company with them (Delete is an Update that
	// sets DeletedAt); no events writes nothing. It returns the company as
	// read back. It never changes IsDefault.
	Update(ctx context.Context, id uuid.UUID, m Mutation) (Company, error)
	// MakeDefault locks the live company (ErrNotFound) and the current
	// default, applies m to the company and the current default (nil when
	// there is none) and, when m returns events, makes the company the only
	// default and writes them. It returns the company as read back.
	MakeDefault(ctx context.Context, id uuid.UUID, m func(cur Company, old *Company) (Company, []audit.Event, error)) (Company, error)
}
