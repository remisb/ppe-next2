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
// for Copy for WhatsApp; the default SIM card provider for Add SIM); only
// administrators change the supplier's group, and whoever registers SIM cards
// (assets.manage) the default provider.
func registerSettingsRoutes(rt *router, svc *settings.Service, timezone string) {
	h := &settingsHandler{settings: svc, timezone: timezone}
	rt.authenticated("GET /api/v1/settings", h.get)
	rt.restricted("PUT /api/v1/settings/supplier-chat", h.updateSupplierChat, role.SettingsManage)
	rt.restricted("PUT /api/v1/settings/default-sim-provider", h.updateDefaultSIMProvider, role.AssetsManage)
}

// settingsJSON: timezone and currency come from config, the rest from the
// settings service. supplier_chat and default_sim_provider are null when not set.
type settingsJSON struct {
	Timezone           string                 `json:"timezone"`
	Currency           string                 `json:"currency"`
	SupplierChat       *settings.SupplierChat `json:"supplier_chat"`
	DefaultSIMProvider *string                `json:"default_sim_provider"`
}

func (h *settingsHandler) toJSON(s settings.Settings) settingsJSON {
	out := settingsJSON{Timezone: h.timezone, Currency: "EUR"}
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

// defaultSIMProviderRequest replaces the default provider; empty clears it.
type defaultSIMProviderRequest struct {
	Provider string `json:"provider"`
}

func (h *settingsHandler) updateDefaultSIMProvider(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req defaultSIMProviderRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.settings.UpdateDefaultSIMProvider(r.Context(), req.Provider, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, h.toJSON(s))
}
