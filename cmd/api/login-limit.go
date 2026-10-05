package main

import (
	"errors"
	"strings"
	"sync"
	"time"
)

// errTooManyAttempts refuses a sign-in for an account that has had too many
// failed ones recently (429).
var errTooManyAttempts = errors.New("too many failed sign-ins for this account; try again later")

// emailLimiter slows password guessing against one account from many
// addresses, which the per-address limit cannot see. After max failed sign-ins
// for an email within interval (counted from the first failure), that email is
// refused until the interval ends. Only failures count and a successful sign-in
// clears them, so a user who signs in normally is never limited. Someone who
// knows an email can still keep that account's sign-in shut by failing on
// purpose; the interval is short for that reason. Emails compare
// case-insensitively, as accounts do.
type emailLimiter struct {
	max      int
	interval time.Duration
	now      func() time.Time

	mu       sync.Mutex
	failures map[string]*failureWindow
}

type failureWindow struct {
	count int
	ends  time.Time
}

// pruneAbove is how many tracked emails trigger dropping the expired ones, so
// guesses at many made-up emails cannot grow the map without bound.
const pruneAbove = 10_000

func newEmailLimiter(max int, interval time.Duration) *emailLimiter {
	return &emailLimiter{max: max, interval: interval, now: time.Now, failures: map[string]*failureWindow{}}
}

func emailKey(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

// blocked reports whether email is refused now and, if so, for how much longer.
// A nil limiter (the per-email limit switched off) blocks nothing.
func (l *emailLimiter) blocked(email string) (bool, time.Duration) {
	if l == nil {
		return false, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	w, ok := l.failures[emailKey(email)]
	now := l.now()
	if !ok || !now.Before(w.ends) || w.count < l.max {
		return false, 0
	}
	return true, w.ends.Sub(now)
}

// failed counts one failed sign-in for email.
func (l *emailLimiter) failed(email string) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	key := emailKey(email)
	w, ok := l.failures[key]
	if !ok || !now.Before(w.ends) {
		if len(l.failures) >= pruneAbove {
			for k, v := range l.failures {
				if !now.Before(v.ends) {
					delete(l.failures, k)
				}
			}
		}
		w = &failureWindow{ends: now.Add(l.interval)}
		l.failures[key] = w
	}
	w.count++
}

// succeeded clears email's failures.
func (l *emailLimiter) succeeded(email string) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, emailKey(email))
}
