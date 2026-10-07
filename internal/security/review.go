package security

import (
	"time"

	"github.com/google/uuid"
)

// EventAccessReviewCompleted is the audit event Mark as reviewed records: a
// business decision, kept with the other changes rather than with sign-ins.
const EventAccessReviewCompleted = "access_review.completed"

// DormantAfter is how long without a sign-in makes an active account dormant.
const DormantAfter = 90 * 24 * time.Hour

// Flags the access review raises on a user.
const (
	// FlagDormant: active, and no sign-in for DormantAfter (or none recorded,
	// on an account older than that).
	FlagDormant = "dormant"
	// FlagNoSignIn: no sign-in recorded. Sign-ins are recorded from
	// migration 0024; earlier ones only where a session row was still kept.
	FlagNoSignIn = "no_sign_in"
	// FlagAdministrator: holds the built-in Administrator role.
	FlagAdministrator = "administrator"
)

// ReviewRole is a role as the review names it. Key is set on the built-in
// roles, which the apps name in the reader's language.
type ReviewRole struct {
	ID   uuid.UUID `json:"id"`
	Key  *string   `json:"key"`
	Name string    `json:"name"`
}

// ReviewUser is one account in the access review.
type ReviewUser struct {
	ID           uuid.UUID    `json:"id"`
	Name         string       `json:"name"`
	Email        string       `json:"email"`
	IsActive     bool         `json:"is_active"`
	CreatedAt    time.Time    `json:"created_at"`
	LastSignInAt *time.Time   `json:"last_sign_in_at"`
	LiveSessions int          `json:"live_sessions"`
	Roles        []ReviewRole `json:"roles"`
	// Permissions are what the roles allow together, sorted.
	Permissions []string `json:"permissions"`
	Flags       []string `json:"flags"`
}

// LastReview is the latest Mark as reviewed.
type LastReview struct {
	At      time.Time  `json:"at"`
	ByID    *uuid.UUID `json:"by_id"`
	ByName  *string    `json:"by_name"`
	EventID uuid.UUID  `json:"event_id"`
}

// Review is the access review: every user with what they may do and when they
// last signed in, the roles nobody holds, and the last time it was reviewed.
type Review struct {
	Users       []ReviewUser `json:"users"`
	UnusedRoles []ReviewRole `json:"unused_roles"`
	LastReview  *LastReview  `json:"last_review"`
	// DormantAfterDays is DormantAfter in days, for the screen's words.
	DormantAfterDays int `json:"dormant_after_days"`
}

// ReviewData is what the store reads; the service adds the flags.
type ReviewData struct {
	Users       []ReviewUser
	UnusedRoles []ReviewRole
	LastReview  *LastReview
}

// summary is what Mark as reviewed records: how many accounts carried each
// flag when it was reviewed.
type summary struct {
	Users          int `json:"users"`
	ActiveUsers    int `json:"active_users"`
	Administrators int `json:"administrators"`
	Dormant        int `json:"dormant"`
	NoSignIn       int `json:"no_sign_in"`
}

func summarise(users []ReviewUser) summary {
	var s summary
	for _, u := range users {
		s.Users++
		if u.IsActive {
			s.ActiveUsers++
		}
		for _, f := range u.Flags {
			switch f {
			case FlagAdministrator:
				s.Administrators++
			case FlagDormant:
				s.Dormant++
			case FlagNoSignIn:
				s.NoSignIn++
			}
		}
	}
	return s
}
