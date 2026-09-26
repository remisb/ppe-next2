package dashboard

import "context"

type Repository interface {
	// Read returns the stored figures for w, all from one consistent snapshot.
	// Months has one entry per month of w (zeros included), oldest first; the
	// derived fields are left empty.
	Read(ctx context.Context, w Window) (Overview, error)
	// ReadManager returns the manager's figures for w from one consistent
	// snapshot, Months as in Read; the derived fields and Sizes are left empty.
	ReadManager(ctx context.Context, w ManagerWindow) (ManagerFigures, error)
	// ReadEmployee returns the order preparer's figures for w from one
	// consistent snapshot, Months as in Read; the derived fields are left empty.
	ReadEmployee(ctx context.Context, w EmployeeWindow) (EmployeeOverview, error)
}
