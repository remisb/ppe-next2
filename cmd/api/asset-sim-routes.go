package main

import (
	"net/http"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/asset"
)

// simBatchRequest is a Scan SIMs batch: what the cards share, then the cards.
type simBatchRequest struct {
	Provider            *string        `json:"provider"`
	Plan                *string        `json:"plan"`
	NonReturnValueCents *int64         `json:"non_return_value_cents"`
	ReceivedDate        *string        `json:"received_date"`
	Comment             string         `json:"comment"`
	Cards               []simBatchCard `json:"cards"`
}

// simBatchCard is one card: its SIM No. and, when its back was read, its PIN
// and PUK.
type simBatchCard struct {
	SimNo string `json:"sim_no"`
	PIN   string `json:"pin"`
	PUK   string `json:"puk"`
}

func (b simBatchRequest) params() asset.AddSIMsParams {
	p := asset.AddSIMsParams{
		Provider: b.Provider, Plan: b.Plan, NonReturnValueCents: b.NonReturnValueCents, ReceivedDate: b.ReceivedDate,
		Comment: b.Comment, Cards: make([]asset.ScannedSIM, len(b.Cards)),
	}
	for i, c := range b.Cards {
		p.Cards[i] = asset.ScannedSIM{SimNo: c.SimNo, PIN: c.PIN, PUK: c.PUK}
	}
	return p
}

// simProblem is one problem of a batch's card; the apps word its code.
type simProblem struct {
	Index      int               `json:"index"`
	Field      string            `json:"field"`
	Code       asset.ProblemCode `json:"code"`
	ExistingID *uuid.UUID        `json:"existing_id,omitempty"`
	Other      *int              `json:"other,omitempty"`
}

type addedSIM struct {
	ID          uuid.UUID `json:"id"`
	InventoryNo string    `json:"inventory_no"`
	SimNo       string    `json:"sim_no"`
}

type simCodesBody struct {
	PIN string `json:"pin"`
	PUK string `json:"puk"`
}

// checkSIMs is the review list's check: every problem of every card, nothing
// written. A problem with what the cards share is a 400.
func (h *assetHandler) checkSIMs(w http.ResponseWriter, r *http.Request) {
	var req simBatchRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	ps, err := h.assets.CheckSIMs(r.Context(), req.params())
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]simProblem, len(ps))
	for i, p := range ps {
		out[i] = simProblem{Index: p.Index, Field: p.Field, Code: p.Code, ExistingID: p.ExistingID, Other: p.Other}
	}
	writeJSON(w, http.StatusOK, map[string]any{"problems": out})
}

// addSIMs is Add on Scan SIMs: the batch registered all or none. A refused
// card is named by its index, and a duplicate by the card it duplicates.
func (h *assetHandler) addSIMs(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req simBatchRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	added, err := h.assets.AddSIMs(r.Context(), req.params(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	out := make([]addedSIM, len(added))
	for i, a := range added {
		out[i] = addedSIM{ID: a.ID, InventoryNo: a.InventoryNo, SimNo: a.SimNo}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"sims": out})
}

// showSIMCodes is Show PIN and PUK. It records who saw them, so it is a
// POST, and the answer is never stored by the browser or a proxy.
func (h *assetHandler) showSIMCodes(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	c, err := h.assets.ShowSIMCodes(r.Context(), id, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, simCodesBody{PIN: c.PIN, PUK: c.PUK})
}

// setSIMCodes keeps a SIM card's PIN and PUK in place of any it had.
func (h *assetHandler) setSIMCodes(w http.ResponseWriter, r *http.Request) {
	actor, id, req, ok := withAsset[simCodesBody](w, r)
	if !ok {
		return
	}
	if err := h.assets.SetSIMCodes(r.Context(), id, asset.SIMCodes{PIN: req.PIN, PUK: req.PUK}, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// clearSIMCodes forgets a SIM card's PIN and PUK.
func (h *assetHandler) clearSIMCodes(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	id, err := parseUUIDPath(r, "id")
	if err != nil {
		writeError(w, r, err)
		return
	}
	if err := h.assets.ClearSIMCodes(r.Context(), id, actor); err != nil {
		writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
