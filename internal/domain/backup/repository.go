package backup

import "context"

// Repository reads what the backup agent records; nothing in the app writes it.
type Repository interface {
	// Read returns the agent, the newest limit runs, the newest success and the
	// kept totals from one consistent snapshot; the derived fields are left empty.
	Read(ctx context.Context, limit int) (Status, error)
}
