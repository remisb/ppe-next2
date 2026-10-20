package main

import (
	"net/http"

	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/settings"
)

type settingsHandler struct {
	settings *settings.Service
	timezone string
}

// registerSettingsRoutes mounts /api/v1/settings. Every signed-in user reads
// them (dates in the zone Orders filters use; the supplier's WhatsApp group
// for Copy for WhatsApp; the SIM providers and default value for Add SIM); only
// administrators change them.
func registerSettingsRoutes(rt *router, svc *settings.Service, timezone string) {
	h := &settingsHandler{settings: svc, timezone: timezone}
	rt.authenticated("GET /api/v1/settings", h.get)
	rt.restricted("PUT /api/v1/settings/supplier-chat", h.updateSupplierChat, role.SettingsManage)
	rt.restricted("PUT /api/v1/settings/sim-providers", h.updateSIMProviders, role.SettingsManage)
}

// settingsJSON: timezone and currency come from config, the rest from the
// settings service. supplier_chat, default_sim_provider and
// default_sim_non_return_value_cents are null when not set; sim_providers is a
// list, empty when there are none.
type settingsJSON struct {
	Timezone                      string                 `json:"timezone"`
	Currency                      string                 `json:"currency"`
	SupplierChat                  *settings.SupplierChat `json:"supplier_chat"`
	SIMProviders                  []string               `json:"sim_providers"`
	DefaultSIMProvider            *string                `json:"default_sim_provider"`
	DefaultSIMNonReturnValueCents *int64                 `json:"default_sim_non_return_value_cents"`
}

func (h *settingsHandler) toJSON(s settings.Settings) settingsJSON {
	out := settingsJSON{Timezone: h.timezone, Currency: "EUR", SIMProviders: s.SIMProviders, DefaultSIMNonReturnValueCents: s.DefaultSIMNonReturnValueCents}
	if out.SIMProviders == nil {
		out.SIMProviders = []string{}
	}
	if s.SupplierChat.Set() {
		chat := s.SupplierChat
		out.SupplierChat = &chat
	}
	if p := s.DefaultSIMProvider; p != "" {
		out.DefaultSIMProvider = &p
	}
	return out
}

func (h *settingsHandler) get(w http.ResponseWriter, r *http.Request) {
	s, err := h.settings.Get(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, h.toJSON(s))
}

// supplierChatRequest replaces the group; both empty clears it.
type supplierChatRequest struct {
	Name string `json:"name"`
	Link string `json:"link"`
}

func (h *settingsHandler) updateSupplierChat(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req supplierChatRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.settings.UpdateSupplierChat(r.Context(), settings.SupplierChatParams{Name: req.Name, Link: req.Link}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, h.toJSON(s))
}

// simProvidersRequest replaces the providers, the default one (empty for
// none) and the default Non-return Value (null or absent for none).
type simProvidersRequest struct {
	Providers                  []string `json:"providers"`
	Default                    string   `json:"default"`
	DefaultNonReturnValueCents *int64   `json:"default_non_return_value_cents"`
}

func (h *settingsHandler) updateSIMProviders(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req simProvidersRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.settings.UpdateSIMProviders(r.Context(), settings.SIMProvidersParams{
		Providers: req.Providers, Default: req.Default, DefaultNonReturnValueCents: req.DefaultNonReturnValueCents,
	}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, h.toJSON(s))
}
