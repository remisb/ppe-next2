// Package session keeps sign-ins: one Session per sign-in on one browser,
// which holds it as a refresh token in a cookie. The access token stays a
// short JWT (cmd/api/auth.go); a session is what lets the browser get a new
// one without the password, and what ending a sign-in ends.
package session

import (
	"time"

	"github.com/google/uuid"
)

// Session is one sign-in. Its refresh token is never stored: it is derived
// from ID, Seed and Generation (token.go).
type Session struct {
	ID     uuid.UUID
	UserID uuid.UUID
	Seed   []byte
	// Generation counts refreshes: each one moves it on and gives the browser
	// the new token. RotatedAt is when it last moved.
	Generation int
	RotatedAt  time.Time
	// KeepSignedIn is "Keep me signed in": the longer limit and an idle limit,
	// and a cookie that outlives the browser.
	KeepSignedIn bool
	CreatedAt    time.Time
	// AuthenticatedAt is when the password was last entered: at sign-in, or
	// later to confirm it (Reauthenticated).
	AuthenticatedAt time.Time
	LastUsedAt      time.Time
	IdleExpiresAt   time.Time
	ExpiresAt       time.Time
	EndedAt         *time.Time
	EndReason       string
	UserAgent       string
	IP              string
}

// Live reports whether the session can still be used at now.
func (s Session) Live(now time.Time) bool {
	return s.EndedAt == nil && now.Before(s.ExpiresAt) && now.Before(s.IdleExpiresAt)
}

// Why a session ended (user_sessions.end_reason).
const (
	// ReasonSignedOut: Sign out on that browser.
	ReasonSignedOut = "signed_out"
	// ReasonEndedElsewhere: signed out from another device's list.
	ReasonEndedElsewhere = "ended_elsewhere"
	// ReasonEndedByAdministrator: ended on Administration's Security screen.
	ReasonEndedByAdministrator = "ended_by_administrator"
	ReasonPasswordChanged      = "password_changed"
	// ReasonPasswordReset: an administrator set a new password.
	ReasonPasswordReset = "password_reset"
	ReasonDeactivated   = "deactivated"
	ReasonDeleted       = "deleted"
	// ReasonReused: a refresh token older than the current one came back,
	// so a copy of the cookie is in someone else's hands.
	ReasonReused = "reused"
)

var reasons = []string{
	ReasonSignedOut, ReasonEndedElsewhere, ReasonEndedByAdministrator, ReasonPasswordChanged, ReasonPasswordReset,
	ReasonDeactivated, ReasonDeleted, ReasonReused,
}

// Limits are how long sessions last.
type Limits struct {
	// MaxAge ends a session without Keep me signed in this long after sign-in.
	MaxAge time.Duration
	// KeepMaxAge ends one with it this long after sign-in, and KeepIdle
	// once it has not been used for this long.
	KeepMaxAge time.Duration
	KeepIdle   time.Duration
}

// StartParams describe a new sign-in.
type StartParams struct {
	UserID       uuid.UUID
	KeepSignedIn bool
	UserAgent    string
	IP           string
	// EmailHash is the email the sign-in named (security.Service.EmailHash),
	// recorded with its sign_in event: a success clears that email's failures
	// for the per-email limit.
	EmailHash []byte
}

// Seen is the browser and address a session is used from.
type Seen struct {
	UserAgent string
	IP        string
}

// maxUserAgent bounds the stored User-Agent, which the client controls.
const maxUserAgent = 400

func (p Seen) normalize() Seen {
	if len(p.UserAgent) > maxUserAgent {
		p.UserAgent = p.UserAgent[:maxUserAgent]
	}
	return p
}
