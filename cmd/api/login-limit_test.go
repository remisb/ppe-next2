package main

import (
	"fmt"
	"testing"
	"time"
)

func TestEmailLimiter(t *testing.T) {
	now := time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)
	l := newEmailLimiter(3, 15*time.Minute)
	l.now = func() time.Time { return now }

	for range 2 {
		l.failed("ona@example.com")
	}
	if blocked, _ := l.blocked("ona@example.com"); blocked {
		t.Fatal("blocked after 2 of 3 failures")
	}
	l.failed(" ONA@example.com ")
	blocked, wait := l.blocked("ona@example.com")
	if !blocked || wait != 15*time.Minute {
		t.Fatalf("after 3 failures = %v, %v; want blocked for 15m", blocked, wait)
	}
	if blocked, _ := l.blocked("jonas@example.com"); blocked {
		t.Error("another email is blocked")
	}

	// The window counts from the first failure and ends 15 minutes later.
	now = now.Add(10 * time.Minute)
	if _, wait := l.blocked("ona@example.com"); wait != 5*time.Minute {
		t.Errorf("wait after 10m = %v, want 5m", wait)
	}
	now = now.Add(5 * time.Minute)
	if blocked, _ := l.blocked("ona@example.com"); blocked {
		t.Error("still blocked when the window ended")
	}
	// A new failure starts a new window rather than adding to the old one.
	l.failed("ona@example.com")
	if blocked, _ := l.blocked("ona@example.com"); blocked {
		t.Error("blocked after one failure in a new window")
	}

	// A success clears the failures.
	l.failed("ona@example.com")
	l.succeeded("ona@example.com")
	l.failed("ona@example.com")
	l.failed("ona@example.com")
	if blocked, _ := l.blocked("ona@example.com"); blocked {
		t.Error("failures before a success still count")
	}
}

func TestEmailLimiterDropsExpiredWindows(t *testing.T) {
	now := time.Date(2026, 10, 5, 9, 0, 0, 0, time.UTC)
	l := newEmailLimiter(3, time.Minute)
	l.now = func() time.Time { return now }
	for i := range pruneAbove {
		l.failed(fmt.Sprintf("u%d@example.com", i))
	}
	now = now.Add(2 * time.Minute)
	l.failed("new@example.com")
	if len(l.failures) != 1 {
		t.Errorf("tracked emails = %d, want only the new one", len(l.failures))
	}
}

func TestEmailLimiterOff(t *testing.T) {
	var l *emailLimiter
	l.failed("x@example.com")
	l.succeeded("x@example.com")
	if blocked, _ := l.blocked("x@example.com"); blocked {
		t.Error("a nil limiter blocked")
	}
}
