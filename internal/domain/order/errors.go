package order

import (
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no live order with that id (a deleted one is not there), or
	// a GIVEN order without its confirmation evidence.
	ErrNotFound = apperr.New(apperr.NotFound, "order.not_found", "order not found")
	// ErrInvalid: the request breaks a rule the service checks; fieldError
	// wraps it with the field and the problem.
	ErrInvalid = apperr.New(apperr.Invalid, "order.invalid", "invalid order")
	// ErrPriceMissing: a catalogue item lacks an accounting price or a service
	// period, so Mark as Ordered is blocked until an authorised user fixes the
	// catalogue.
	ErrPriceMissing = apperr.New(apperr.Conflict, "order.price_missing", "catalogue item has no accounting price or service period")
	// ErrItemUnavailable: a catalogue item is inactive or deleted.
	ErrItemUnavailable = apperr.New(apperr.Conflict, "order.item_unavailable", "catalogue item is not available")
	// ErrNotOrdered: the action needs an ORDERED order (e.g. a confirmation
	// link), or a concurrent confirmation gave the order first.
	ErrNotOrdered = apperr.New(apperr.Conflict, "order.not_ordered", "order is not in ORDERED status")
	// ErrLinkExpired covers unknown, expired and revoked links, and links to a
	// deleted order: request a new one.
	ErrLinkExpired = apperr.New(apperr.Gone, "order.link_expired", "confirmation link expired or revoked; request a new link")
	// ErrActorNotFound: the acting user (the preparer or the giver) is not a
	// user, or not a live one where Mark as Ordered reads the preparer.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "order.actor_not_found", "acting user not found")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

var (
	// ErrEmployeeNotFound: no live employee with that id (EmployeeReader and
	// Mark as Ordered's share lock).
	ErrEmployeeNotFound = apperr.New(apperr.NotFound, "order.employee_not_found", "employee not found")
	// ErrItemSetNotFound: no active, live item set with that id.
	ErrItemSetNotFound = apperr.New(apperr.NotFound, "order.item_set_not_found", "item set not found")
)
