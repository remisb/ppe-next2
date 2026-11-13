package audit

import (
	"context"

	"github.com/google/uuid"
)

// Source is where a change was made: which app, a public confirmation link,
// or the system itself (seeding, jobs). Besides these, a registered App
// Launcher app's slug (its X-PPE-App) is a Source too: migration 0042 widened
// 0023's list to any slug-shaped value.
type Source string

const (
	// SourceWorkwear is the staff app.
	SourceWorkwear Source = "workwear"
	// SourceAdmin is Administration.
	SourceAdmin Source = "admin"
	// SourceAPI is any other client: no X-PPE-App, or one naming no app.
	SourceAPI Source = "api"
	// SourcePublicLink is a public confirmation link (/api/v1/confirmations/).
	SourcePublicLink Source = "public_link"
	// SourceSystem is work done without a request (seeding, jobs).
	SourceSystem Source = "system"
)

// Request is the context a change was made in. The HTTP layer puts it on the
// request's context (WithRequest); Insert reads it from the context the
// repository writes with. Domain services never see it: they pass their
// context through, as they do for cancellation.
type Request struct {
	ID        string    // the X-Request-ID; "" when there is none
	SessionID uuid.UUID // the sign-in; uuid.Nil when the request has none
	Source    Source
	// AppVersion is the build of the app that sent it (X-PPE-App-Version),
	// for an app published under /apps/; "" otherwise. Only System's error
	// list records it.
	AppVersion string
	// UserID is the signed-in user (the access token's subject); uuid.Nil
	// when the request has none. IP and UserAgent are the client's. Insert
	// records none of the three: the security log does (internal/security).
	UserID    uuid.UUID
	IP        string
	UserAgent string
}

// requestKey is the context key of the Request.
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
