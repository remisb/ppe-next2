// Package security keeps the security log (auth_events, migration 0024; ADR
// 0003): sign-ins, failed attempts and how sessions end. Like internal/audit it
// is infrastructure, not a domain: the session service decides what happened
// and its repository calls Insert in the transaction that changes the session;
// the sign-in handlers record failures, which change nothing else, through
// Service.Refused. Service is the read side (the Security screen), the per-email
// sign-in limit, the access review and the purge.
package security

import (
	"context"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Kind is what happened.
type Kind string

const (
	KindSignIn       Kind = "sign_in"
	KindSignInFailed Kind = "sign_in_failed"
	// KindReauth: the password entered again in a sign-in, to manage users.
	KindReauth       Kind = "reauth"
	KindReauthFailed Kind = "reauth_failed"
	// KindSignedOut: Sign out on that browser.
	KindSignedOut Kind = "signed_out"
	// KindSessionEnded: ended from elsewhere, by a password change or reset,
	// deactivation, deletion or an administrator; Reason says which.
	KindSessionEnded Kind = "session_ended"
	// KindRefreshReused: a replaced refresh token came back, so a copy of the
	// cookie is in someone else's hands and the session was ended.
	KindRefreshReused Kind = "refresh_reused"
)

// kinds is every Kind, in the Security screen filter's order. Migration 0024
// lists the same values, and @ppe/api-client's SECURITY_KINDS mirrors them
// (TestWebClientListsTheKinds).
var kinds = []Kind{
	KindSignIn, KindSignInFailed, KindReauth, KindReauthFailed,
	KindSignedOut, KindSessionEnded, KindRefreshReused,
}

// Kinds returns every Kind in filter order.
func Kinds() []Kind { return slices.Clone(kinds) }

// IsKind reports whether k is known.
func IsKind(k Kind) bool { return slices.Contains(kinds, k) }

// Why a sign-in or reauth failed. A session_ended event's reason is the
// session's end reason (session.ReasonEndedElsewhere …).
const (
	ReasonUnknownEmail = "unknown_email"
	ReasonBadPassword  = "bad_password"
	ReasonInactive     = "inactive"
	// ReasonTooManyAttempts: refused by the per-email limit before the
	// password was checked. Such attempts do not count towards the limit.
	ReasonTooManyAttempts = "too_many_attempts"
)

// failureReasons are the failures the per-email limit counts.
var failureReasons = []string{ReasonUnknownEmail, ReasonBadPassword, ReasonInactive}

// Event is one auth_events row as a writer builds it. The request's address,
// browser, ID, app and signed-in user are added by Insert from the context.
type Event struct {
	ID         uuid.UUID
	OccurredAt time.Time
	Kind       Kind
	// UserID is the account; nil for a failed sign-in naming an unknown email.
	UserID *uuid.UUID
	// EmailHash is the email a sign-in or reauth named (Service.EmailHash).
	EmailHash []byte
	SessionID *uuid.UUID
	Reason    string
}

// maxUserAgent bounds the stored User-Agent, which the client controls; the
// session keeps the same length.
const maxUserAgent = 400

// Insert writes ev with the request ctx carries (audit.RequestFrom): its ID,
// app, address and browser, and the signed-in user as the actor. Call it with
// the transaction that makes the change ev describes.
func Insert(ctx context.Context, db audit.Execer, ev Event) error {
	req := audit.RequestFrom(ctx)
	ua := req.UserAgent
	if len(ua) > maxUserAgent {
		ua = ua[:maxUserAgent]
	}
	_, err := db.Exec(ctx, `
		INSERT INTO auth_events (id, occurred_at, kind, user_id, actor_user_id, email_hash, session_id, reason,
			ip, user_agent, request_id, source)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		ev.ID, ev.OccurredAt, string(ev.Kind), ev.UserID, nilUUID(req.UserID), ev.EmailHash, ev.SessionID,
		nilString(ev.Reason), nilString(req.IP), nilString(ua), nilString(req.ID), string(req.Source))
	return err
}

func nilUUID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}

func nilString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
