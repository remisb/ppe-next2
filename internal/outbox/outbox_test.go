package outbox

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestBackoff(t *testing.T) {
	for n, want := range map[int]time.Duration{0: 30 * time.Second, 1: 30 * time.Second, 2: time.Minute, 3: 2 * time.Minute, 7: 32 * time.Minute, 8: time.Hour, 9: time.Hour, 60: time.Hour} {
		if got := Backoff(n); got != want {
			t.Errorf("Backoff(%d) = %s, want %s", n, got, want)
		}
	}
}

func TestPermanent(t *testing.T) {
	err := fmt.Errorf("extract: %w", Permanent(errors.New("not a PDF")))
	if !IsPermanent(err) || IsPermanent(errors.New("x")) || err.Error() != "extract: not a PDF" {
		t.Fatalf("IsPermanent wrong for %v", err)
	}
}
