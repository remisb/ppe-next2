package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/monitor"
	"github.com/remisb/ppe-next2/internal/system"
)

// requestIDHandler adds the request's ID (requestContext) to every log line
// written with its context, so a reference shown to a person finds the lines:
// make prod-logs | grep <reference>.
type requestIDHandler struct{ slog.Handler }

func (h requestIDHandler) Handle(ctx context.Context, rec slog.Record) error {
	if id := audit.RequestFrom(ctx).ID; id != "" {
		rec.AddAttrs(slog.String("request_id", id))
	}
	return h.Handler.Handle(ctx, rec)
}

func (h requestIDHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return requestIDHandler{h.Handler.WithAttrs(attrs)}
}

func (h requestIDHandler) WithGroup(name string) slog.Handler {
	return requestIDHandler{h.Handler.WithGroup(name)}
}

// requestState is what the layers inside observe tell it about a request:
// the route pattern it was registered under (router's named), and why it failed. The handler may run
// on the Timeout middleware's goroutine after observe has moved on, hence
// the lock.
type requestState struct {
	mu       sync.Mutex
	route    string
	err      string
	panicked bool
	stack    string
}

type stateKey struct{}

func stateFrom(ctx context.Context) *requestState {
	st, _ := ctx.Value(stateKey{}).(*requestState)
	return st
}

func (st *requestState) set(f func(*requestState)) {
	if st == nil {
		return
	}
	st.mu.Lock()
	defer st.mu.Unlock()
	f(st)
}

func (st *requestState) read() (route, err string, panicked bool, stack string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	return st.route, st.err, st.panicked, st.stack
}

// failed notes why a request is answered 500, for the error list.
func failed(r *http.Request, err error) {
	stateFrom(r.Context()).set(func(st *requestState) { st.err = err.Error() })
}

// statusWriter keeps the status a handler answered.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

// statusClientClosed is the status a request the client abandoned is counted under.
const statusClientClosed = 499

// probes are polled by Docker and the uptime check; they are left out of the
// request window, which would otherwise be mostly them.
var probes = map[string]bool{"GET /health": true, "GET /ready": true}

// observe counts every request in the metrics and the 24-hour window by its
// route pattern, and puts every 5xx on the error list: why it failed when
// writeError or capturePanics said, else the status's name.
func observe(svc services, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			st := &requestState{}
			sw := &statusWriter{ResponseWriter: w}
			next.ServeHTTP(sw, r.WithContext(context.WithValue(r.Context(), stateKey{}, st)))
			d := time.Since(start)
			status := sw.status
			if status == 0 {
				status = http.StatusOK
			}
			// The client went away (a closed tab, a cancelled fetch): the
			// Timeout middleware answers 503 to no one. Counted as 499, as
			// nginx names it, and not the API's error.
			if errors.Is(r.Context().Err(), context.Canceled) {
				status = statusClientClosed
			}
			route, msg, panicked, stack := st.read()
			if route == "" {
				route = "unmatched"
			}
			svc.metrics.ObserveRequest(route, r.Method, status, d)
			if !probes[route] {
				svc.window.Observe(route, status, d, start)
			}
			noteActivity(r, svc, logger)
			if status < 500 || status == statusClientClosed {
				return
			}
			report := system.Report{Kind: system.KindServer, Route: route, Method: r.Method, Status: status, Message: msg, Stack: stack}
			switch {
			case panicked:
				report.Kind = system.KindPanic
			case report.Message == "" && status == http.StatusServiceUnavailable:
				report.Message = "request timed out (API_REQUEST_TIMEOUT)"
			case report.Message == "":
				report.Message = http.StatusText(status)
			}
			// The request may have been cancelled (a timeout); the record must not be.
			ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 3*time.Second)
			defer cancel()
			if err := svc.system.Record(ctx, report); err != nil {
				logger.ErrorContext(ctx, "error list: record failed", slog.Any("error", err))
			}
		})
	}
}

// noteActivity notes, for the Usage screen, that the signed-in user used their app
// today; the usage service writes it once a day per user and app.
func noteActivity(r *http.Request, svc services, logger *slog.Logger) {
	req := audit.RequestFrom(r.Context())
	app := string(req.Source)
	if req.UserID == uuid.Nil || (req.Source != audit.SourceWorkwear && req.Source != audit.SourceAdmin && req.Source != audit.SourceAPI) {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 3*time.Second)
	defer cancel()
	if err := svc.usage.Seen(ctx, req.UserID, app); err != nil {
		logger.ErrorContext(ctx, "usage: activity not recorded", slog.Any("error", err))
	}
}

// capturePanics recovers a handler's panic, answers 500 with the request's
// reference, and tells observe. It sits inside the Timeout middleware, whose
// goroutine the outer Recoverer cannot reach: without it a panicking handler
// would stop the API.
func capturePanics(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				rec := recover()
				if rec == nil {
					return
				}
				if rec == http.ErrAbortHandler {
					panic(rec)
				}
				stack := string(debug.Stack())
				msg := fmt.Sprint(rec)
				stateFrom(r.Context()).set(func(st *requestState) { st.panicked, st.err, st.stack = true, msg, stack })
				logger.ErrorContext(r.Context(), "panic recovered", slog.String("error", msg), slog.String("method", r.Method),
					slog.String("path", r.URL.Path), slog.String("stack", stack))
				writeJSON(w, http.StatusInternalServerError, errorBody{Error: "internal error", Reference: audit.RequestFrom(r.Context()).ID})
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// newWindow starts the request window when the API starts.
func newWindow() *monitor.Window { return monitor.NewWindow(time.Now()) }
