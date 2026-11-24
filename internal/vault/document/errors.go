package document

import (
	"errors"
	"fmt"
)

var (
	// ErrNotFound: no live document with that id the reader may see, or no
	// such version.
	ErrNotFound = errors.New("document not found")
	// ErrSubjectNotFound: a link names something that does not exist or the
	// reader may not see.
	ErrSubjectNotFound = errors.New("linked record not found")
	// ErrInvalid: the request breaks a rule; fieldError wraps it.
	ErrInvalid = errors.New("invalid document")
	// ErrLocked: the document is its source's (archived or migrated), or the
	// link was made by generation or archiving.
	ErrLocked = errors.New("this document is kept by the app and cannot be changed this way")
	// ErrForbidden: the reader may see the type but not change it.
	ErrForbidden = errors.New("you may not change documents of this type")
	// ErrTooLarge: the file is over the type's limit.
	ErrTooLarge = errors.New("the file is too large")
	// ErrFileType: the file is not a type the document's type takes.
	ErrFileType = errors.New("the file must be a PDF, JPEG or PNG")
	// ErrNoStorage: no files store is set up (API_FILES_TARGET).
	ErrNoStorage = errors.New("file storage is not set up, so documents cannot be kept")
	// ErrActorNotFound: the acting user is not a user.
	ErrActorNotFound = errors.New("acting user not found")
	// ErrDamaged: a stored file no longer matches its hash.
	ErrDamaged = errors.New("the stored file does not match its hash")
)

// fieldError is ErrInvalid naming field and its problem.
func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}
