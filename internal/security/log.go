package security

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

var (
	// ErrInvalid wraps every refused filter or parameter, naming it.
	ErrInvalid = errors.New("invalid security request")
	// ErrNotFound: no live session with that id.
	ErrNotFound = errors.New("not found")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// Entry is one security event as the Security screen shows it: the stored row
// with the account's and the actor's current names.
type Entry struct {
	ID         uuid.UUID `json:"id"`
	OccurredAt time.Time `json:"occurred_at"`
	Kind       Kind      `json:"kind"`
	Reason     *string   `json:"reason"`
	// UserID, UserName and UserEmail are the account; nil for an attempt at
	// an email nobody has.
	UserID    *uuid.UUID `json:"user_id"`
	UserName  *string    `json:"user_name"`
	UserEmail *string    `json:"user_email"`
	// EmailRef is the start of the hash of the email an attempt named, so
	// attempts at one unknown email can be told apart without storing it.
	EmailRef  *string       `json:"email_ref"`
	ActorID   *uuid.UUID    `json:"actor_id"`
	ActorName *string       `json:"actor_name"`
	SessionID *uuid.UUID    `json:"session_id"`
	IP        *string       `json:"ip"`
	UserAgent *string       `json:"user_agent"`
	RequestID *string       `json:"request_id"`
	Source    *audit.Source `json:"source"`
}

// Filter selects events for the Security screen; every field is optional and
// they combine. FromDate and ToDate are inclusive days in the organisation's
// timezone.
type Filter struct {
	Kind     Kind
	UserID   *uuid.UUID
	FromDate string
	ToDate   string
	After    *audit.Cursor
	PageSize int
}

// Query is a Filter checked and resolved; the store reads it.
type Query struct {
	Kind   Kind
	UserID *uuid.UUID
	From   *time.Time // inclusive
	To     *time.Time // exclusive
	After  *audit.Cursor
	Limit  int
}

// Page is one page of security events, newest first. Next continues it; nil
// on the last page.
type Page struct {
	Events []Entry `json:"events"`
	Next   *string `json:"next"`
}

const dateLayout = "2006-01-02"

func (f Filter) resolve(loc *time.Location) (Query, error) {
	q := Query{Kind: f.Kind, UserID: f.UserID, After: f.After, Limit: f.PageSize}
	switch {
	case f.Kind != "" && !IsKind(f.Kind):
		return Query{}, fieldError("kind", "is not known")
	case f.PageSize < 0 || f.PageSize > audit.MaxPageSize:
		return Query{}, fieldError("page_size", fmt.Sprintf("must be between 1 and %d", audit.MaxPageSize))
	}
	if q.Limit == 0 {
		q.Limit = audit.DefaultPageSize
	}
	if f.FromDate != "" {
		d, err := time.ParseInLocation(dateLayout, f.FromDate, loc)
		if err != nil {
			return Query{}, fieldError("from", "must be a date YYYY-MM-DD")
		}
		q.From = &d
	}
	if f.ToDate != "" {
		d, err := time.ParseInLocation(dateLayout, f.ToDate, loc)
		if err != nil {
			return Query{}, fieldError("to", "must be a date YYYY-MM-DD")
		}
		end := d.AddDate(0, 0, 1)
		q.To = &end
	}
	if q.From != nil && q.To != nil && !q.From.Before(*q.To) {
		return Query{}, fieldError("to", "must not be before from")
	}
	return q, nil
}

// LiveSession is one user's session live now, as the Security screen lists
// every user's.
type LiveSession struct {
	ID           uuid.UUID `json:"id"`
	UserID       uuid.UUID `json:"user_id"`
	UserName     string    `json:"user_name"`
	UserEmail    string    `json:"user_email"`
	KeepSignedIn bool      `json:"keep_signed_in"`
	CreatedAt    time.Time `json:"created_at"`
	LastUsedAt   time.Time `json:"last_used_at"`
	// ExpiresAt is when it ends if not used before: the earlier of its idle
	// and absolute limits.
	ExpiresAt time.Time `json:"expires_at"`
	UserAgent string    `json:"user_agent"`
	IP        string    `json:"ip"`
}
