// Package launcherhttp is App Launcher's HTTP API (ADR 0006, 0009;
// docs/specs/app-launcher.md): what each user sees, their pins, feedback and
// channel choices, and Manage apps with its versions, channels and Trials.
// The host mounts Routes behind its own authentication and lends the
// handlers its JSON, error and identity helpers (Host), so its answers and
// error statuses stay the host's.
package launcherhttp

import (
	"context"
	"net/http"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/launcher"
)

// Host is what the host application lends the handlers.
type Host struct {
	// Actor is the signed-in user, or an error the host's Error answers.
	Actor func(*http.Request) (uuid.UUID, error)
	// Can is what the request's sign-in allows, by the host's permission keys.
	Can func(*http.Request) func(string) bool
	// Decode reads a JSON body, refusing unknown fields.
	Decode func(http.ResponseWriter, *http.Request, any) error
	// Write answers status with v as JSON.
	Write func(w http.ResponseWriter, status int, v any)
	// Error answers err, mapping the launcher's sentinels to statuses.
	Error func(w http.ResponseWriter, r *http.Request, err error)
}

// VersionUse is how many people used a version, on how many days.
type VersionUse struct{ People, Days int }

// VersionErrors is how many kinds of error a version had, and how often.
type VersionErrors struct{ Kinds, Occurrences int }

// TrialStats is the host's side of the Trials view: who used each version of
// an app over the last Days, and its errors. A host without them answers
// empty maps.
type TrialStats interface {
	Days() int
	VersionUse(ctx context.Context, app string) (map[string]VersionUse, error)
	VersionErrors(ctx context.Context, app string) (map[string]VersionErrors, error)
}

// Route is one route: its pattern, handler, and the host permission it needs
// ("" for any signed-in user).
type Route struct {
	Pattern    string
	Handler    http.HandlerFunc
	Permission string
}

// handler serves the routes.
type handler struct {
	apps  *launcher.Service
	host  Host
	stats TrialStats
}

// Routes are the launcher's routes, for any signed-in user, and Manage
// apps', for the host's manage permission.
func Routes(apps *launcher.Service, host Host, stats TrialStats, manage string) []Route {
	h := &handler{apps: apps, host: host, stats: stats}
	return []Route{
		{"GET /api/v1/launcher", h.forUser, ""},
		{"PUT /api/v1/launcher/pins", h.setPins, ""},
		{"POST /api/v1/launcher/feedback", h.giveFeedback, ""},
		{"PUT /api/v1/launcher/choices/{slug}", h.chooseChannel, ""},
		{"GET /api/v1/apps", h.list, manage},
		{"POST /api/v1/apps", h.create, manage},
		{"PUT /api/v1/apps/{slug}", h.update, manage},
		{"POST /api/v1/apps/{slug}/move", h.move, manage},
		{"GET /api/v1/apps/{slug}/feedback", h.feedback, manage},
		{"GET /api/v1/apps/{slug}/releases", h.releases, manage},
		{"PUT /api/v1/apps/{slug}/channels/{name}", h.pointChannel, manage},
		{"PUT /api/v1/apps/{slug}/stable-follows-deploys", h.stableFollowsDeploys, manage},
		{"GET /api/v1/apps/{slug}/trials", h.trials, manage},
	}
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

// forUser answers the signed-in user's launcherList.
func (h *handler) forUser(w http.ResponseWriter, r *http.Request) {
	user, err := h.host.Actor(r)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	apps, pins, err := h.apps.ForUser(r.Context(), user, h.host.Can(r))
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	channels, choices, err := h.apps.ChannelsFor(r.Context(), user, apps, h.host.Can(r))
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusOK, launcherList{Apps: apps, Pins: pins, Preview: h.host.Can(r)(h.apps.Config().Preview), Channels: channels, Choices: choices})
}

// choiceRequest names the channel the user opens an app on.
type choiceRequest struct {
	Channel string `json:"channel"`
}

// chooseChannel keeps the channel the user opens an app on; "" or stable is the default.
func (h *handler) chooseChannel(w http.ResponseWriter, r *http.Request) {
	user, err := h.host.Actor(r)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	var req choiceRequest
	if err := h.host.Decode(w, r, &req); err != nil {
		h.host.Error(w, r, err)
		return
	}
	if err := h.apps.ChooseChannel(r.Context(), user, r.PathValue("slug"), req.Channel, h.host.Can(r)); err != nil {
		h.host.Error(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pinsRequest is the user's pins, in order; also the answer.
type pinsRequest struct {
	Slugs []string `json:"slugs"`
}

// setPins replaces the user's pins and answers them.
func (h *handler) setPins(w http.ResponseWriter, r *http.Request) {
	user, err := h.host.Actor(r)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	var req pinsRequest
	if err := h.host.Decode(w, r, &req); err != nil {
		h.host.Error(w, r, err)
		return
	}
	if req.Slugs == nil {
		req.Slugs = []string{}
	}
	pins, err := h.apps.SetPins(r.Context(), user, req.Slugs, h.host.Can(r))
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusOK, pinsRequest{Slugs: pins})
}

// feedbackRequest is feedback on an app, as launcher.FeedbackParams.
type feedbackRequest struct {
	App      string `json:"app"`
	Rating   string `json:"rating"`
	Text     string `json:"text"`
	Device   string `json:"device"`
	Language string `json:"language"`
}

// giveFeedback stores feedback on an app the user sees and answers it (201).
func (h *handler) giveFeedback(w http.ResponseWriter, r *http.Request) {
	user, err := h.host.Actor(r)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	var req feedbackRequest
	if err := h.host.Decode(w, r, &req); err != nil {
		h.host.Error(w, r, err)
		return
	}
	f, err := h.apps.GiveFeedback(r.Context(), user, launcher.FeedbackParams(req), h.host.Can(r))
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusCreated, f)
}

// list answers every tile, retired ones included (Manage apps).
func (h *handler) list(w http.ResponseWriter, r *http.Request) {
	apps, err := h.apps.List(r.Context())
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusOK, apps)
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

// fields is q as the registry takes it.
func (q appRequest) fields() launcher.Fields {
	return launcher.Fields{
		Parent: q.Parent, Group: launcher.Group(q.Group), Icon: q.Icon, Color: q.Color, Href: q.Href,
		Tier: launcher.Tier(q.Tier), Stage: launcher.Stage(q.Stage), Names: q.Names, AnyOf: q.AnyOf,
	}
}

// createAppRequest registers a tile: its slug and kind, then its fields.
type createAppRequest struct {
	Slug string `json:"slug"`
	Kind string `json:"kind"`
	appRequest
}

// create registers a tile and answers it (201).
func (h *handler) create(w http.ResponseWriter, r *http.Request) {
	actor, err := h.host.Actor(r)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	var req createAppRequest
	if err := h.host.Decode(w, r, &req); err != nil {
		h.host.Error(w, r, err)
		return
	}
	a, err := h.apps.Create(r.Context(), launcher.CreateParams{Slug: req.Slug, Kind: launcher.Kind(req.Kind), Fields: req.fields()}, actor)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusCreated, a)
}

// update replaces a tile's fields and answers it.
func (h *handler) update(w http.ResponseWriter, r *http.Request) {
	actor, err := h.host.Actor(r)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	var req appRequest
	if err := h.host.Decode(w, r, &req); err != nil {
		h.host.Error(w, r, err)
		return
	}
	a, err := h.apps.Update(r.Context(), r.PathValue("slug"), launcher.UpdateParams{Fields: req.fields()}, actor)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusOK, a)
}

// moveAppRequest puts the tile in front of another, or last when before is "".
type moveAppRequest struct {
	Before string `json:"before"`
}

// move answers every tile in the new order.
func (h *handler) move(w http.ResponseWriter, r *http.Request) {
	actor, err := h.host.Actor(r)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	var req moveAppRequest
	if err := h.host.Decode(w, r, &req); err != nil {
		h.host.Error(w, r, err)
		return
	}
	apps, err := h.apps.Move(r.Context(), r.PathValue("slug"), req.Before, actor)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusOK, apps)
}

// feedback answers the feedback on a tile, newest first.
func (h *handler) feedback(w http.ResponseWriter, r *http.Request) {
	list, err := h.apps.Feedback(r.Context(), r.PathValue("slug"))
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusOK, list)
}

// releases is an app's published versions, newest first, and its channels.
type releases struct {
	Versions []launcher.Version `json:"versions"`
	Channels []launcher.Channel `json:"channels"`
}

// releases answers an app's versions and channels.
func (h *handler) releases(w http.ResponseWriter, r *http.Request) {
	versions, channels, err := h.apps.Releases(r.Context(), r.PathValue("slug"))
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusOK, releases{Versions: versions, Channels: channels})
}

// channelRequest points a channel (stable, beta or preview) at a version.
type channelRequest struct {
	Version string `json:"version"`
}

// pointChannel points a channel at a version and answers the channel.
func (h *handler) pointChannel(w http.ResponseWriter, r *http.Request) {
	actor, err := h.host.Actor(r)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	var req channelRequest
	if err := h.host.Decode(w, r, &req); err != nil {
		h.host.Error(w, r, err)
		return
	}
	c, err := h.apps.PointChannel(r.Context(), r.PathValue("slug"), r.PathValue("name"), launcher.ChannelParams(req), actor)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusOK, c)
}

// followsRequest turns Stable follows deploys on or off.
type followsRequest struct {
	On bool `json:"on"`
}

// stableFollowsDeploys turns on or off whether a deploy's publish to Preview
// moves Stable too; it answers the tile.
func (h *handler) stableFollowsDeploys(w http.ResponseWriter, r *http.Request) {
	actor, err := h.host.Actor(r)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	var req followsRequest
	if err := h.host.Decode(w, r, &req); err != nil {
		h.host.Error(w, r, err)
		return
	}
	a, err := h.apps.SetStableFollowsDeploys(r.Context(), r.PathValue("slug"), req.On, actor)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	h.host.Write(w, http.StatusOK, a)
}

// trial is one version in an app's Trials view (ADR 0006, phase 5): the
// launcher's (channels, feedback) and the host's TrialStats (people and days
// over its window, the kinds of error last seen on it).
type trial struct {
	launcher.Trial
	People     int `json:"people"`
	Days       int `json:"days"`
	ErrorKinds int `json:"error_kinds"`
	Errors     int `json:"errors"`
}

// trials is an app's Trials view, newest version first.
type trials struct {
	// Days is the window people and days are counted over.
	Days     int     `json:"days"`
	Versions []trial `json:"versions"`
}

// trials answers an app's Trials view.
func (h *handler) trials(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	list, err := h.apps.Trials(r.Context(), slug)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	use, err := h.stats.VersionUse(r.Context(), slug)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	errs, err := h.stats.VersionErrors(r.Context(), slug)
	if err != nil {
		h.host.Error(w, r, err)
		return
	}
	out := trials{Days: h.stats.Days(), Versions: make([]trial, 0, len(list))}
	for _, t := range list {
		u, e := use[t.Version], errs[t.Version]
		out.Versions = append(out.Versions, trial{Trial: t, People: u.People, Days: u.Days, ErrorKinds: e.Kinds, Errors: e.Occurrences})
	}
	h.host.Write(w, http.StatusOK, out)
}
