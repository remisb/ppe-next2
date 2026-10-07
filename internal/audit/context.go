package audit

import (
	"context"

	"github.com/google/uuid"
)

// Source is where a change was made: which app, a public confirmation link,
// or the system itself (seeding, jobs). Migration 0023 lists the same values.
type Source string

const (
	SourceWorkwear   Source = "workwear"
	SourceAdmin      Source = "admin"
	SourceAPI        Source = "api"
	SourcePublicLink Source = "public_link"
	SourceSystem     Source = "system"
)

// Request is the context a change was made in. The HTTP layer puts it on the
// request's context (WithRequest); Insert reads it from the context the
// repository writes with. Domain services never see it: they pass their
// context through, as they do for cancellation.
type Request struct {
	ID        string    // the X-Request-ID; "" when there is none
	SessionID uuid.UUID // the sign-in; uuid.Nil when the request has none
	Source    Source
	// UserID is the signed-in user (the access token's subject); uuid.Nil
	// when the request has none. IP and UserAgent are the client's. Insert
	// records none of the three: the security log does (internal/security).
	UserID    uuid.UUID
	IP        string
	UserAgent string
}

type requestKey struct{}

// WithRequest returns ctx carrying r for the events written under it.
func WithRequest(ctx context.Context, r Request) context.Context {
	return context.WithValue(ctx, requestKey{}, r)
}

// RequestFrom returns the request ctx carries; a context with none is the
// system's own work (seeding, a job), with no request or session.
func RequestFrom(ctx context.Context) Request {
	if r, ok := ctx.Value(requestKey{}).(Request); ok {
		return r
	}
	return Request{Source: SourceSystem}
}
