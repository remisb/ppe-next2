package audit

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

var (
	// ErrInvalid wraps every refused filter, naming it.
	ErrInvalid = errors.New("invalid audit filter")
	// ErrNotFound is a history asked of a record that does not exist.
	ErrNotFound = errors.New("not found")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// Entry is one event as the Audit log shows it: the stored row, the record's
// and the actor's current names, and the device of the sign-in it was made in.
type Entry struct {
	ID         uuid.UUID `json:"id"`
	OccurredAt time.Time `json:"occurred_at"`
	Event      string    `json:"event"`
	Area       Area      `json:"area"`
	EntityType string    `json:"entity_type"`
	EntityID   uuid.UUID `json:"entity_id"`
	// EntityLabel names the record now (an employee's name, an order's record
	// number); nil when it has none or no longer exists. EntityDeleted is true
	// for a record that has been deleted since.
	EntityLabel   *string    `json:"entity_label"`
	EntityDeleted bool       `json:"entity_deleted"`
	ActorID       *uuid.UUID `json:"actor_id"`
	ActorName     *string    `json:"actor_name"`
	// Source, RequestID and SessionID are nil on events written before
	// migration 0023 recorded them. SessionUserAgent is the sign-in's browser
	// while its session row is kept (30 days after it ends).
	Source           *Source         `json:"source"`
	RequestID        *string         `json:"request_id"`
	SessionID        *uuid.UUID      `json:"session_id"`
	SessionUserAgent *string         `json:"session_user_agent"`
	Before           json.RawMessage `json:"before"`
	After            json.RawMessage `json:"after"`
}

// Cursor is where a page ends: the last entry's time and id. The next page
// continues strictly after it in newest-first order.
type Cursor struct {
	At time.Time
	ID uuid.UUID
}

// String encodes c for the API's next and after values.
func (c Cursor) String() string {
	return base64.RawURLEncoding.EncodeToString([]byte(c.At.UTC().Format(time.RFC3339Nano) + "|" + c.ID.String()))
}

// ParseCursor reads a value Cursor.String wrote.
func ParseCursor(s string) (Cursor, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return Cursor{}, fieldError("after", "is not a page cursor")
	}
	at, id, ok := strings.Cut(string(raw), "|")
	if !ok {
		return Cursor{}, fieldError("after", "is not a page cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, at)
	if err != nil {
		return Cursor{}, fieldError("after", "is not a page cursor")
	}
	u, err := uuid.Parse(id)
	if err != nil {
		return Cursor{}, fieldError("after", "is not a page cursor")
	}
	return Cursor{At: t.UTC(), ID: u}, nil
}

const (
	DefaultPageSize = 50
	MaxPageSize     = 200
	// HistoryLimit is the most events a record's History shows.
	HistoryLimit = 100
	dateLayout   = "2006-01-02"
)

// Filter selects events for the Audit log; every field is optional and they
// combine. FromDate and ToDate are inclusive calendar days in the
// organisation's timezone.
type Filter struct {
	Area       Area
	Event      string
	ActorID    *uuid.UUID
	EntityType string
	EntityID   *uuid.UUID
	FromDate   string
	ToDate     string
	After      *Cursor
	PageSize   int
}

// Query is a Filter checked and resolved: dates as instants and the area as
// entity types. The store reads it.
type Query struct {
	ID          *uuid.UUID // one event
	EntityTypes []string
	Event       string
	ActorID     *uuid.UUID
	EntityID    *uuid.UUID
	From        *time.Time // inclusive
	To          *time.Time // exclusive
	After       *Cursor
	Limit       int
}

// Page is one page of the Audit log, newest first. Next continues it; nil on
// the last page.
type Page struct {
	Events []Entry `json:"events"`
	Next   *string `json:"next"`
}

// resolve checks f and turns it into a Query in loc.
func (f Filter) resolve(loc *time.Location) (Query, error) {
	q := Query{Event: f.Event, ActorID: f.ActorID, EntityID: f.EntityID, After: f.After, Limit: f.PageSize}
	switch {
	case f.Area != "" && entitiesOf(f.Area) == nil:
		return Query{}, fieldError("area", "is not known")
	case f.Event != "" && !IsEvent(f.Event):
		return Query{}, fieldError("event", "is not known")
	case f.EntityID != nil && f.EntityType == "":
		return Query{}, fieldError("entity_id", "needs entity_type")
	case f.EntityType != "" && AreaOf(f.EntityType) == "":
		return Query{}, fieldError("entity_type", "is not known")
	case f.Area != "" && f.EntityType != "" && AreaOf(f.EntityType) != f.Area:
		return Query{}, fieldError("entity_type", "is not in area "+string(f.Area))
	case f.PageSize < 0 || f.PageSize > MaxPageSize:
		return Query{}, fieldError("page_size", fmt.Sprintf("must be between 1 and %d", MaxPageSize))
	}
	if q.Limit == 0 {
		q.Limit = DefaultPageSize
	}
	switch {
	case f.EntityType != "":
		q.EntityTypes = []string{f.EntityType}
	case f.Area != "":
		q.EntityTypes = entitiesOf(f.Area)
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
