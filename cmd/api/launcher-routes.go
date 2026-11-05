package main

import (
	"context"
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/launcher"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/system"
	"github.com/remisb/ppe-next2/internal/usage"
)

// App Launcher's registry (ADR 0006, phase 2; docs/specs/app-launcher.md):
// what each user sees, their pins and feedback, and Manage apps.
type launcherHandler struct {
	apps *launcher.Service
	// For the Trials view: who used each version (Usage) and its errors (System).
	use interface {
		VersionUse(context.Context, string) (map[string]usage.VersionUse, error)
	}
	errors interface {
		VersionErrors(context.Context, string) (map[string]system.VersionErrors, error)
	}
}

func registerLauncherRoutes(rt *router, svc *launcher.Service, use *usage.Service, errs *system.Service) {
	h := &launcherHandler{apps: svc, use: use, errors: errs}
	rt.authenticated("GET /api/v1/launcher", h.forUser)
	rt.authenticated("PUT /api/v1/launcher/pins", h.setPins)
	rt.authenticated("POST /api/v1/launcher/feedback", h.giveFeedback)
	rt.authenticated("PUT /api/v1/launcher/choices/{slug}", h.chooseChannel)
	rt.restricted("GET /api/v1/apps", h.list, role.AppsManage)
	rt.restricted("POST /api/v1/apps", h.create, role.AppsManage)
	rt.restricted("PUT /api/v1/apps/{slug}", h.update, role.AppsManage)
	rt.restricted("POST /api/v1/apps/{slug}/move", h.move, role.AppsManage)
	rt.restricted("GET /api/v1/apps/{slug}/feedback", h.feedback, role.AppsManage)
	rt.restricted("GET /api/v1/apps/{slug}/releases", h.releases, role.AppsManage)
	rt.restricted("PUT /api/v1/apps/{slug}/channels/{name}", h.pointChannel, role.AppsManage)
	rt.restricted("PUT /api/v1/apps/{slug}/stable-follows-deploys", h.stableFollowsDeploys, role.AppsManage)
	rt.restricted("GET /api/v1/apps/{slug}/trials", h.trials, role.AppsManage)
}

// can is what the request's token grants, as the registry asks it.
func can(r *http.Request) func(role.Permission) bool {
	return func(p role.Permission) bool { return holds(r, p) }
}

// launcherList is what one user's launcher shows: their tiles, pins among
// them, whether they may see apps in testing (the launcher's switch), the
// channels they see of each published app and the one they chose.
type launcherList struct {
	Apps     []launcher.App                `json:"apps"`
	Pins     []string                      `json:"pins"`
	Preview  bool                          `json:"preview"`
	Channels map[string][]launcher.Channel `json:"channels"`
	Choices  map[string]string             `json:"choices"`
}

func (h *launcherHandler) forUser(w http.ResponseWriter, r *http.Request) {
	user, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	apps, pins, err := h.apps.ForUser(r.Context(), user, can(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	channels, choices, err := h.apps.ChannelsFor(r.Context(), user, apps, can(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, launcherList{Apps: apps, Pins: pins, Preview: holds(r, role.AppsPreview), Channels: channels, Choices: choices})
}

type choiceRequest struct {
	Channel string `json:"channel"`
}

// chooseChannel keeps the channel the user opens an app on; "" or stable is the default.
func (h *launcherHandler) chooseChannel(w http.ResponseWriter, r *http.Request) {
	user, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req choiceRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.apps.ChooseChannel(r.Context(), user, r.PathValue("slug"), req.Channel, can(r)); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type pinsRequest struct {
	Slugs []string `json:"slugs"`
}

func (h *launcherHandler) setPins(w http.ResponseWriter, r *http.Request) {
	user, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req pinsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if req.Slugs == nil {
		req.Slugs = []string{}
	}
	pins, err := h.apps.SetPins(r.Context(), user, req.Slugs, can(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, pinsRequest{Slugs: pins})
}

type feedbackRequest struct {
	App      string `json:"app"`
	Rating   string `json:"rating"`
	Text     string `json:"text"`
	Device   string `json:"device"`
	Language string `json:"language"`
}

func (h *launcherHandler) giveFeedback(w http.ResponseWriter, r *http.Request) {
	user, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req feedbackRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	f, err := h.apps.GiveFeedback(r.Context(), user, launcher.FeedbackParams(req), can(r))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, f)
}

func (h *launcherHandler) list(w http.ResponseWriter, r *http.Request) {
	apps, err := h.apps.List(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, apps)
}

// appRequest is a tile as Manage apps sends it; slug and kind count on
// create only, and an update must not send them.
type appRequest struct {
	Parent string         `json:"parent"`
	Group  string         `json:"group"`
	Icon   string         `json:"icon"`
	Color  string         `json:"color"`
	Href   string         `json:"href"`
	Tier   string         `json:"tier"`
	Stage  string         `json:"stage"`
	Names  launcher.Names `json:"names"`
	AnyOf  []string       `json:"any_of"`
}

func (q appRequest) fields() launcher.Fields {
	return launcher.Fields{
		Parent: q.Parent, Group: launcher.Group(q.Group), Icon: q.Icon, Color: q.Color, Href: q.Href,
		Tier: launcher.Tier(q.Tier), Stage: launcher.Stage(q.Stage), Names: q.Names, AnyOf: q.AnyOf,
	}
}

type createAppRequest struct {
	Slug string `json:"slug"`
	Kind string `json:"kind"`
	appRequest
}

func (h *launcherHandler) create(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req createAppRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	a, err := h.apps.Create(r.Context(), launcher.CreateParams{Slug: req.Slug, Kind: launcher.Kind(req.Kind), Fields: req.fields()}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, a)
}

func (h *launcherHandler) update(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req appRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	a, err := h.apps.Update(r.Context(), r.PathValue("slug"), launcher.UpdateParams{Fields: req.fields()}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

// moveAppRequest puts the tile in front of another, or last when before is "".
type moveAppRequest struct {
	Before string `json:"before"`
}

// move answers every tile in the new order.
func (h *launcherHandler) move(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req moveAppRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	apps, err := h.apps.Move(r.Context(), r.PathValue("slug"), req.Before, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, apps)
}

func (h *launcherHandler) feedback(w http.ResponseWriter, r *http.Request) {
	list, err := h.apps.Feedback(r.Context(), r.PathValue("slug"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// releases is an app's published versions, newest first, and its channels.
type releases struct {
	Versions []launcher.Version `json:"versions"`
	Channels []launcher.Channel `json:"channels"`
}

func (h *launcherHandler) releases(w http.ResponseWriter, r *http.Request) {
	versions, channels, err := h.apps.Releases(r.Context(), r.PathValue("slug"))
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, releases{Versions: versions, Channels: channels})
}

// channelRequest points a channel (stable, beta or preview) at a version.
type channelRequest struct {
	Version string `json:"version"`
}

func (h *launcherHandler) pointChannel(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req channelRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	c, err := h.apps.PointChannel(r.Context(), r.PathValue("slug"), r.PathValue("name"), launcher.ChannelParams(req), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, c)
}

type followsRequest struct {
	On bool `json:"on"`
}

// stableFollowsDeploys turns on or off whether a deploy's publish to Preview
// moves Stable too; it answers the tile.
func (h *launcherHandler) stableFollowsDeploys(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req followsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	a, err := h.apps.SetStableFollowsDeploys(r.Context(), r.PathValue("slug"), req.On, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, a)
}

// trial is one version in an app's Trials view (ADR 0006, phase 5): the
// launcher's (channels, feedback), Usage's (people and days over the last
// usage.Days) and System's (the kinds of error last seen on it).
type trial struct {
	launcher.Trial
	People     int `json:"people"`
	Days       int `json:"days"`
	ErrorKinds int `json:"error_kinds"`
	Errors     int `json:"errors"`
}

type trials struct {
	// Days is the window people and days are counted over.
	Days     int     `json:"days"`
	Versions []trial `json:"versions"`
}

func (h *launcherHandler) trials(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	list, err := h.apps.Trials(r.Context(), slug)
	if err != nil {
		writeError(w, r, err)
		return
	}
	use, err := h.use.VersionUse(r.Context(), slug)
	if err != nil {
		writeError(w, r, err)
		return
	}
	errs, err := h.errors.VersionErrors(r.Context(), slug)
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := trials{Days: usage.Days, Versions: make([]trial, 0, len(list))}
	for _, t := range list {
		u, e := use[t.Version], errs[t.Version]
		out.Versions = append(out.Versions, trial{Trial: t, People: u.People, Days: u.Days, ErrorKinds: e.Kinds, Errors: e.Occurrences})
	}
	writeJSON(w, http.StatusOK, out)
}
