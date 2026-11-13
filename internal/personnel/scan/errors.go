package scan

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound is no scan by that id that the actor may open: none, another
	// user's, or expired (404).
	ErrNotFound = errors.New("scan not found")
	// ErrInvalid is a field that breaks a rule (400); fieldError names it.
	ErrInvalid = errors.New("invalid scan")
	// ErrActorNotFound is an acting user who no longer exists (401).
	ErrActorNotFound = errors.New("acting user not found")
	// ErrNotConfigured is Personnel files without its keys or a files store (503).
	ErrNotConfigured = errors.New("personnel files are not configured")
	// ErrTooManyPages is a scan of more than MaxPages pages (413).
	ErrTooManyPages = errors.New("a scan has at most 10 pages")
	// ErrPageTooLarge is a page over 5 MB (413).
	ErrPageTooLarge = errors.New("a scanned page is too large")
	// ErrPageNotJPEG is a page that is not a JPEG of at most 2400 px (415).
	ErrPageNotJPEG = errors.New("a scanned page must be a JPEG of at most 2400 px")
	// ErrUnopenable is a scan that does not open or whose zip is not the one
	// kept: another key, a changed byte. Never names the scan's contents.
	ErrUnopenable = errors.New("a kept scan does not open")
)

// fieldError is ErrInvalid, naming the field and what is wrong with it.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
