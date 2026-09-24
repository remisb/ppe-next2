package order

import (
	"errors"
	"fmt"
)

var (
	ErrNotFound = errors.New("order not found")
	ErrInvalid  = errors.New("invalid order")
	// ErrPriceMissing: a catalogue item lacks a price or service period, so
	// Mark as Ordered is blocked until an authorised user fixes the catalogue.
	ErrPriceMissing = errors.New("catalogue item has no price or service period")
	// ErrItemUnavailable: a catalogue item is inactive or deleted.
	ErrItemUnavailable = errors.New("catalogue item is not available")
	// ErrNotOrdered: the action needs an ORDERED order (e.g. a confirmation link).
	ErrNotOrdered = errors.New("order is not in ORDERED status")
	// ErrLinkExpired covers expired and revoked links: request a new one.
	ErrLinkExpired   = errors.New("confirmation link expired or revoked; request a new link")
	ErrActorNotFound = errors.New("acting user not found")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

var (
	ErrEmployeeNotFound = errors.New("employee not found")
	ErrItemSetNotFound  = errors.New("item set not found")
)
