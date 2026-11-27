package apperr

import (
	"errors"
	"fmt"
	"testing"
)

func TestErrorKeepsIdentityAndKind(t *testing.T) {
	errMissing := New(NotFound, "thing.not_found", "thing not found")
	other := New(NotFound, "other.not_found", "thing not found")
	wrapped := fmt.Errorf("%w: id 7", errMissing)

	if errMissing.Error() != "thing not found" || wrapped.Error() != "thing not found: id 7" {
		t.Fatalf("messages %q, %q", errMissing, wrapped)
	}
	for _, err := range []error{errMissing, wrapped} {
		if !errors.Is(err, errMissing) || !errors.Is(err, NotFound) {
			t.Errorf("%v: not the sentinel or not its kind", err)
		}
		if errors.Is(err, other) || errors.Is(err, Invalid) {
			t.Errorf("%v: matches another sentinel or kind", err)
		}
		if CodeOf(err) != "thing.not_found" {
			t.Errorf("%v: code %q", err, CodeOf(err))
		}
		var e *Error
		if !errors.As(err, &e) || e.Kind() != NotFound || e.Code() != "thing.not_found" {
			t.Errorf("%v: As gives %+v", err, e)
		}
	}
	if CodeOf(errors.New("plain")) != "" || CodeOf(nil) != "" {
		t.Error("an error without a kind has a code")
	}
}
