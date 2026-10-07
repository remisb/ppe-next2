// Package system keeps what Administration's System screen reads besides the
// in-memory request window (internal/monitor): the error list (error_events,
// migration 0025) and the database's status and size. Like internal/audit it
// is infrastructure: the API's middleware records the errors, and nothing in
// the domains knows about it.
package system

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

var (
	// ErrInvalid wraps every refused report or filter, naming it.
	ErrInvalid = errors.New("invalid system request")
	// ErrNotFound: no such error on the list.
	ErrNotFound = errors.New("not found")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

// Kind is where an error happened.
type Kind string

const (
	// KindServer: the API answered 5xx.
	KindServer Kind = "server"
	// KindPanic: a handler panicked; the API recovered and answered 500.
	KindPanic Kind = "panic"
	// KindClient: an app reported an error in the browser.
	KindClient Kind = "client"
)

// IsKind reports whether k is known.
func IsKind(k Kind) bool { return k == KindServer || k == KindPanic || k == KindClient }

// Limits on what is stored; a report longer than these is cut.
const (
	maxMessage = 1000
	maxStack   = 8000
	maxRoute   = 300
	maxAgent   = 400
)

// FoldWithin is how close to the last occurrence an identical error must be
// to be counted on its row rather than start a new one.
const FoldWithin = time.Hour

// Retention is how long the error list keeps a row after its last occurrence.
const Retention = 30 * 24 * time.Hour

// Report is one error as it happened.
type Report struct {
	Kind Kind
	// Route is the route pattern ("GET /api/v1/orders/{id}"), or for a client
	// error the page's path, its ids replaced (ClientRoute).
	Route   string
	Method  string
	Status  int // 0 for a client error
	Message string
	Stack   string
}

// ErrorEvent is one row of the error list: one kind of error, folded.
type ErrorEvent struct {
	ID          uuid.UUID     `json:"id"`
	Fingerprint string        `json:"fingerprint"`
	Kind        Kind          `json:"kind"`
	Route       string        `json:"route"`
	Method      string        `json:"method"`
	Status      *int          `json:"status"`
	Message     string        `json:"message"`
	Stack       string        `json:"stack"`
	Source      *audit.Source `json:"source"`
	FirstSeen   time.Time     `json:"first_seen"`
	LastSeen    time.Time     `json:"last_seen"`
	Count       int           `json:"count"`
	// LastRequestID is the latest occurrence's request: the reference an
	// error message shows, and the request_id on its log lines.
	LastRequestID *string    `json:"last_request_id"`
	LastUserID    *uuid.UUID `json:"last_user_id"`
	LastUserName  *string    `json:"last_user_name"`
	LastUserAgent *string    `json:"last_user_agent"`
}

var (
	uuidPattern   = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)
	numberPattern = regexp.MustCompile(`\d{2,}`)
	spacePattern  = regexp.MustCompile(`\s+`)
	// A goroutine stack's function lines in this module, for a panic's place.
	ownFrame = regexp.MustCompile(`github\.com/remisb/ppe-next2/[^\s(]+`)
)

// normalise strips what differs between occurrences of one error: ids,
// numbers and spacing.
func normalise(s string) string {
	s = uuidPattern.ReplaceAllString(s, ":id")
	s = numberPattern.ReplaceAllString(s, "#")
	return strings.TrimSpace(spacePattern.ReplaceAllString(s, " "))
}

// fingerprint names one kind of error: its kind, route, method and message
// without ids, and for a panic the first function of this module on its stack.
func fingerprint(r Report) string {
	h := sha256.New()
	fmt.Fprintf(h, "%s\x00%s\x00%s\x00%s", r.Kind, r.Route, r.Method, normalise(r.Message))
	if r.Kind != KindClient {
		if f := ownFrame.FindString(r.Stack); f != "" {
			fmt.Fprintf(h, "\x00%s", f)
		}
	} else if first, _, _ := strings.Cut(strings.TrimSpace(r.Stack), "\n"); first != "" {
		fmt.Fprintf(h, "\x00%s", normalise(first))
	}
	return hex.EncodeToString(h.Sum(nil))[:16]
}

var pathID = regexp.MustCompile(`/(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\d+|WE-\d+)(?:/|$)`)

// ClientRoute is a page's path with its ids replaced, so one page's errors
// group: "/orders/<uuid>" is "/orders/:id". The query and fragment are dropped.
func ClientRoute(path string) string {
	path, _, _ = strings.Cut(path, "?")
	path, _, _ = strings.Cut(path, "#")
	for {
		next := pathID.ReplaceAllStringFunc(path, func(m string) string {
			if strings.HasSuffix(m, "/") {
				return "/:id/"
			}
			return "/:id"
		})
		if next == path {
			return cut(path, maxRoute)
		}
		path = next
	}
}

func cut(s string, n int) string {
	if len(s) <= n {
		return s
	}
	// Do not split a UTF-8 sequence.
	for n > 0 && n < len(s) && s[n]&0xC0 == 0x80 {
		n--
	}
	return s[:n]
}

func (r Report) check() (Report, error) {
	if !IsKind(r.Kind) {
		return r, fieldError("kind", "is not known")
	}
	r.Message = strings.TrimSpace(r.Message)
	if r.Message == "" {
		return r, fieldError("message", "is required")
	}
	r.Message, r.Stack, r.Route = cut(r.Message, maxMessage), cut(r.Stack, maxStack), cut(r.Route, maxRoute)
	if r.Route == "" {
		r.Route = "unmatched"
	}
	return r, nil
}

// ErrorFilter selects the error list; every field is optional.
type ErrorFilter struct {
	Kind     Kind
	After    *audit.Cursor
	PageSize int
}

// ErrorQuery is an ErrorFilter checked; the store reads it.
type ErrorQuery struct {
	ID    *uuid.UUID
	Kind  Kind
	After *audit.Cursor
	Limit int
}

// ErrorPage is one page of the error list, the latest occurrence first.
type ErrorPage struct {
	Errors []ErrorEvent `json:"errors"`
	Next   *string      `json:"next"`
}
