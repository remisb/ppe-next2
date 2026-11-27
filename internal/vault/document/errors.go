package document

import (
	"errors"
	"fmt"

	"github.com/remisb/ppe-next2/internal/apperr"
)

var (
	// ErrNotFound: no live document with that id the reader may see, or no
	// such version.
	ErrNotFound = apperr.New(apperr.NotFound, "vault_document.not_found", "document not found")
	// ErrSubjectNotFound: a link names something that does not exist or the
	// reader may not see.
	ErrSubjectNotFound = apperr.New(apperr.NotFound, "vault_document.subject_not_found", "linked record not found")
	// ErrInvalid: the request breaks a rule; fieldError wraps it.
	ErrInvalid = apperr.New(apperr.Invalid, "vault_document.invalid", "invalid document")
	// ErrLocked: the document is its source's (archived or migrated), or the
	// link was made by generation or archiving.
	ErrLocked = apperr.New(apperr.Conflict, "vault_document.locked", "this document is kept by the app and cannot be changed this way")
	// ErrForbidden: the reader may see the type but not change it.
	ErrForbidden = apperr.New(apperr.Forbidden, "vault_document.forbidden", "you may not change documents of this type")
	// ErrTooLarge: the file is over the type's limit.
	ErrTooLarge = apperr.New(apperr.TooLarge, "vault_document.too_large", "the file is too large")
	// ErrFileType: the file is not a type the document's type takes.
	ErrFileType = apperr.New(apperr.UnsupportedType, "vault_document.file_type", "the file must be a PDF, JPEG or PNG")
	// ErrNoStorage: no files store is set up (API_FILES_TARGET).
	ErrNoStorage = apperr.New(apperr.Unavailable, "vault_document.no_storage", "file storage is not set up, so documents cannot be kept")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = apperr.New(apperr.Unauthenticated, "vault_document.actor_not_found", "acting user not found")
	// ErrDamaged: a stored file no longer matches its hash.
	ErrDamaged = errors.New("the stored file does not match its hash")
	// ErrNotConfigured: a sealed type without API_VAULT_KEY.
	ErrNotConfigured = apperr.New(apperr.Unavailable, "vault_document.not_configured", "sealed documents cannot be kept or opened: the vault's key (API_VAULT_KEY) is not set up")
	// ErrSealed: a sealed document's file opens only through its own route, after Confirm your password.
	ErrSealed = apperr.New(apperr.Conflict, "vault_document.sealed", "a sealed document opens only with a recent sign-in, through POST")
	// ErrHeld: the document is under a Legal Hold and cannot be removed.
	ErrHeld = apperr.New(apperr.Conflict, "vault_document.held", "the document is under a Legal Hold")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
