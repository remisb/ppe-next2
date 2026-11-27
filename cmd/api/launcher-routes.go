package main

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/launcher"
	"github.com/remisb/ppe-next2/internal/domain/launcher/launcherhttp"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/system"
	"github.com/remisb/ppe-next2/internal/usage"
)

// App Launcher's routes (launcherhttp, ADR 0009) on this API: the launcher's
// for any signed-in user, Manage apps' for apps.manage, with this API's
// identity, JSON and error helpers and its Usage and System for Trials.
func registerLauncherRoutes(rt *router, svc *launcher.Service, use *usage.Service, errs *system.Service) {
	host := launcherhttp.Host{Actor: actorID, Can: can, Decode: decodeJSON, Write: writeJSON, Error: writeError}
	for _, r := range launcherhttp.Routes(svc, host, launcherTrials{use: use, errors: errs}, string(role.AppsManage)) {
		if r.Permission == "" {
			rt.authenticated(r.Pattern, r.Handler)
		} else {
			rt.restricted(r.Pattern, r.Handler, role.Permission(r.Permission))
		}
	}
}

// can is what the request's token grants, as the registry asks it.
func can(r *http.Request) func(string) bool {
	return func(p string) bool { return holds(r, role.Permission(p)) }
}

// launcherAudit writes the registry's events to the audit trail, in the
// registry's transaction, with the request's ID, sign-in and app.
type launcherAudit struct{}

// Record inserts evs with tx.
func (launcherAudit) Record(ctx context.Context, tx pgx.Tx, evs []launcher.Event) error {
	for _, ev := range evs {
		if err := audit.Insert(ctx, tx, audit.Event(ev)); err != nil {
			return err
		}
	}
	return nil
}

// launcherUserNames names feedback's senders by their accounts; a removed
// account has no name.
func launcherUserNames(users *user.Service) launcher.UserNames {
	return func(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
		out := make(map[uuid.UUID]string, len(ids))
		for _, id := range ids {
			u, err := users.Get(ctx, id)
			if errors.Is(err, user.ErrNotFound) {
				continue
			}
			if err != nil {
				return nil, err
			}
			out[id] = u.Name
		}
		return out, nil
	}
}

// launcherTrials is the Trials view's people (Usage, over usage.Days) and
// errors (System) per version.
type launcherTrials struct {
	use interface {
		VersionUse(context.Context, string) (map[string]usage.VersionUse, error)
	}
	errors interface {
		VersionErrors(context.Context, string) (map[string]system.VersionErrors, error)
	}
}

// Days is Usage's window.
func (launcherTrials) Days() int { return usage.Days }

// VersionUse is Usage's, per version.
func (t launcherTrials) VersionUse(ctx context.Context, app string) (map[string]launcherhttp.VersionUse, error) {
	use, err := t.use.VersionUse(ctx, app)
	if err != nil {
		return nil, err
	}
	out := make(map[string]launcherhttp.VersionUse, len(use))
	for v, u := range use {
		out[v] = launcherhttp.VersionUse{People: u.People, Days: u.Days}
	}
	return out, nil
}

// VersionErrors is System's, per version.
func (t launcherTrials) VersionErrors(ctx context.Context, app string) (map[string]launcherhttp.VersionErrors, error) {
	errs, err := t.errors.VersionErrors(ctx, app)
	if err != nil {
		return nil, err
	}
	out := make(map[string]launcherhttp.VersionErrors, len(errs))
	for v, e := range errs {
		out[v] = launcherhttp.VersionErrors{Kinds: e.Kinds, Occurrences: e.Occurrences}
	}
	return out, nil
}
