package mailtemplate

import (
	"context"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Mutation computes a template's new state from its current, locked one
// (Template{Key: key} when it was never saved) and the event to record with
// it (nil for none). A returned error aborts the write.
type Mutation func(cur Template) (Template, *audit.Event, error)

// Repository stores the templates that were saved; one that was not reads as
// its use case's default, which the service fills in. Implementations
// translate storage errors to this package's sentinels and never validate.
type Repository interface {
	// List returns every saved template.
	List(ctx context.Context) ([]Template, error)
	// Get returns the saved template with that key, or Template{Key: key}
	// when it was never saved.
	Get(ctx context.Context, key string) (Template, error)
	// Update locks the template with that key, applies m and writes the
	// result with its event.
	Update(ctx context.Context, key string, m Mutation) (Template, error)
}
