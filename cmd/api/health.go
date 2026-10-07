package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"runtime/debug"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// commit is the source revision the binary was built from, set by the
// Dockerfile: -ldflags "-X main.commit=<git describe>". Empty in `go run`
// and tests; buildCommit then falls back to Go's own VCS stamp.
var commit string

// buildCommit names the build in /ready and the startup log.
func buildCommit() string {
	if commit != "" {
		return commit
	}
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	var rev string
	var dirty bool
	for _, s := range info.Settings {
		switch s.Key {
		case "vcs.revision":
			rev = s.Value
		case "vcs.modified":
			dirty = s.Value == "true"
		}
	}
	if rev == "" {
		return "unknown"
	}
	if len(rev) > 12 {
		rev = rev[:12]
	}
	if dirty {
		rev += "-dirty"
	}
	return rev
}

var (
	errDatabaseUnreachable = errors.New("database unreachable")
	errMigrationsPending   = errors.New("migrations pending")
)

// readiness reports whether the API can serve requests.
type readiness interface {
	Ready(ctx context.Context) error
}

// dbReadiness is ready when the database answers and has applied every
// migration this build expects (a newer database is fine).
type dbReadiness struct {
	pool *pgxpool.Pool
	want []string
}

func (d dbReadiness) Ready(ctx context.Context) error {
	if err := d.pool.Ping(ctx); err != nil {
		return fmt.Errorf("%w: %w", errDatabaseUnreachable, err)
	}
	rows, err := d.pool.Query(ctx, `SELECT filename FROM schema_migrations WHERE filename = ANY($1)`, d.want)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "42P01" { // no schema_migrations yet
			return fmt.Errorf("%w: none applied", errMigrationsPending)
		}
		return fmt.Errorf("%w: %w", errDatabaseUnreachable, err)
	}
	applied := map[string]bool{}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return fmt.Errorf("%w: %w", errDatabaseUnreachable, err)
		}
		applied[name] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("%w: %w", errDatabaseUnreachable, err)
	}
	missing := slices.DeleteFunc(slices.Clone(d.want), func(n string) bool { return applied[n] })
	if len(missing) > 0 {
		return fmt.Errorf("%w: %s", errMigrationsPending, strings.Join(missing, ", "))
	}
	return nil
}

// readyTimeout bounds one readiness check, well inside the container
// healthcheck's own timeout.
const readyTimeout = 2 * time.Second

// readyHandler serves GET /ready: 200 when ready, else 503 naming the problem
// in one word. The detail (which migration, the driver's error) goes to the
// log only, since the route is public.
func readyHandler(ready readiness) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		ctx, cancel := context.WithTimeout(r.Context(), readyTimeout)
		defer cancel()
		err := ready.Ready(ctx)
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "commit": buildCommit()})
			return
		}
		problem := "database"
		if errors.Is(err, errMigrationsPending) {
			problem = "migrations"
		}
		slog.WarnContext(r.Context(), "not ready", slog.Any("error", err))
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not ready", "problem": problem, "commit": buildCommit()})
	}
}

// probeReady is the -healthcheck mode: it asks the API listening on addr
// whether it is ready, copies the answer to out and fails unless it is 200.
// The image is scratch, so the container healthcheck has no curl to do this.
func probeReady(ctx context.Context, addr string, out io.Writer) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("-healthcheck: listen address %q: %w", addr, err)
	}
	if ip := net.ParseIP(host); host == "" || (ip != nil && ip.IsUnspecified()) {
		host = "127.0.0.1"
	}
	ctx, cancel := context.WithTimeout(ctx, readyTimeout+time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+net.JoinHostPort(host, port)+"/ready", nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("-healthcheck: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(out, io.LimitReader(resp.Body, 4<<10))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("-healthcheck: /ready answered %s", resp.Status)
	}
	return nil
}
