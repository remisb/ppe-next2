package dashboard

import "context"

type Repository interface {
	// Read returns the stored figures for w, all from one consistent snapshot.
	// Months has one entry per month of w (zeros included), oldest first; the
	// derived fields are left empty.
	Read(ctx context.Context, w Window) (Overview, error)
}
