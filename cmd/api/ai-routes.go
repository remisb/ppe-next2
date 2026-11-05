package main

import (
	"context"
	"encoding/csv"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/aiusage"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/personnel/colour"
)

// Settings → AI and AI Usage (ADR 0007, decision 8; docs/specs/ai-usage-service.md),
// and Make Colour Photo (AI) (decision 7). The OpenAI key is written, replaced
// and removed here, never read back: setting or removing it needs a recent
// sign-in, and it is checked with OpenAI before it is saved.

// keyChecker asks OpenAI whether a key works, for free (colour.OpenAI.Check).
type keyChecker interface {
	Check(ctx context.Context, key string) error
}

type aiHandler struct {
	settings *aiusage.SettingsService
	ledger   *aiusage.Service
	report   aiusage.ReportStore
	checker  keyChecker
	colour   *colour.Service
}

func registerAIRoutes(rt *router, h *aiHandler, sensitive func(role.Permission, http.HandlerFunc) http.HandlerFunc) {
	rt.restricted("GET /api/v1/settings/ai", h.getSettings, role.SettingsManage)
	rt.restricted("PUT /api/v1/settings/ai", h.putSettings, role.SettingsManage)
	rt.restricted("PUT /api/v1/settings/ai/key", sensitive(role.SettingsManage, h.setKey), role.SettingsManage)
	rt.restricted("DELETE /api/v1/settings/ai/key", sensitive(role.SettingsManage, h.removeKey), role.SettingsManage)
	rt.restricted("POST /api/v1/settings/ai/key/test", h.testKey, role.SettingsManage)
	rt.restricted("GET /api/v1/ai-usage", h.getReport, role.AIUsageRead)
	rt.restricted("GET /api/v1/ai-usage/calls", h.getCalls, role.AIUsageRead)
	rt.restricted("GET /api/v1/ai-usage/calls.csv", h.getCallsCSV, role.AIUsageRead)
	rt.restricted("GET /api/v1/personnel/portraits/colorize", h.colorizeAvailable, role.PersonnelPortraitsColorize)
	rt.restricted("POST /api/v1/personnel/portraits/colorize", h.colorize, role.PersonnelPortraitsColorize)
}

// aiSettingsAnswer is Settings → AI as the screen shows it.
type aiSettingsAnswer struct {
	aiusage.Settings
	// CanSaveKey is whether this server can seal a key (API_SECRETS_KEY).
	CanSaveKey          bool  `json:"can_save_key"`
	SpentThisMonthMicro int64 `json:"spent_this_month_micro_usd"`
}

func (h *aiHandler) answer(w http.ResponseWriter, r *http.Request, s aiusage.Settings) {
	spent, err := h.ledger.SpentThisMonth(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeNoStore(w)
	writeJSON(w, http.StatusOK, aiSettingsAnswer{Settings: s, CanSaveKey: h.settings.CanSealKeys(), SpentThisMonthMicro: spent})
}

func (h *aiHandler) getSettings(w http.ResponseWriter, r *http.Request) {
	s, err := h.settings.Settings(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.answer(w, r, s)
}

func (h *aiHandler) putSettings(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req struct {
		Enabled        bool                      `json:"enabled"`
		Model          string                    `json:"model"`
		Quality        string                    `json:"quality"`
		Prices         map[string]aiusage.Prices `json:"prices"`
		BudgetMicroUSD *int64                    `json:"budget_micro_usd"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.settings.Update(r.Context(), aiusage.SettingsInput{Enabled: req.Enabled, Model: req.Model, Quality: req.Quality, Prices: req.Prices, BudgetMicroUSD: req.BudgetMicroUSD}, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.answer(w, r, s)
}

// errKeyRefused is a key OpenAI does not take: it is not saved (400).
var errKeyRefused = errors.New("OpenAI refused this key; it was not saved")

func (h *aiHandler) setKey(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	var req struct {
		Key string `json:"key"`
	}
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, r, err)
		return
	}
	if !h.settings.CanSealKeys() {
		writeError(w, r, aiusage.ErrNoSecretsKey)
		return
	}
	if err := h.checker.Check(r.Context(), req.Key); err != nil {
		var refused *colour.Error
		if errors.As(err, &refused) {
			writeError(w, r, errKeyRefused)
			return
		}
		writeError(w, r, err)
		return
	}
	s, err := h.settings.SetKey(r.Context(), req.Key, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.answer(w, r, s)
}

func (h *aiHandler) removeKey(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	s, err := h.settings.RemoveKey(r.Context(), actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	h.answer(w, r, s)
}

// testKey checks the saved key with OpenAI: {ok, error_code}.
func (h *aiHandler) testKey(w http.ResponseWriter, r *http.Request) {
	key, err := h.settings.Key(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	res := struct {
		OK        bool   `json:"ok"`
		ErrorCode string `json:"error_code,omitempty"`
	}{OK: true}
	if err := h.checker.Check(r.Context(), key); err != nil {
		var refused *colour.Error
		if !errors.As(err, &refused) {
			writeError(w, r, err)
			return
		}
		res.OK, res.ErrorCode = false, refused.Code
	}
	writeJSON(w, http.StatusOK, res)
}

func (h *aiHandler) getReport(w http.ResponseWriter, r *http.Request) {
	s, err := h.settings.Settings(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	rep, err := h.ledger.Report(r.Context(), h.report, s.BudgetMicroUSD)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

// filterOf reads the calls' filter: from and to (RFC 3339), operation, user, outcome, limit, offset.
func filterOf(r *http.Request) (aiusage.Filter, error) {
	q := r.URL.Query()
	var f aiusage.Filter
	for key, dst := range map[string]*time.Time{"from": &f.From, "to": &f.To} {
		if v := q.Get(key); v != "" {
			t, err := time.Parse(time.RFC3339, v)
			if err != nil {
				return f, errBadRequest
			}
			*dst = t
		}
	}
	f.Operation = aiusage.Operation(q.Get("operation"))
	f.Outcome = aiusage.Outcome(q.Get("outcome"))
	if v := q.Get("user"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			return f, errBadRequest
		}
		f.UserID = id
	}
	for key, dst := range map[string]*int{"limit": &f.Limit, "offset": &f.Offset} {
		if v := q.Get(key); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 {
				return f, errBadRequest
			}
			*dst = n
		}
	}
	return f, nil
}

func (h *aiHandler) getCalls(w http.ResponseWriter, r *http.Request) {
	f, err := filterOf(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	calls, err := h.report.Calls(r.Context(), f)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, calls)
}

func (h *aiHandler) getCallsCSV(w http.ResponseWriter, r *http.Request) {
	f, err := filterOf(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	f.Limit = 1000
	calls, err := h.report.Calls(r.Context(), f)
	if err != nil {
		writeError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="ai-usage.csv"`)
	cw := csv.NewWriter(w)
	_ = cw.Write([]string{"at", "operation", "model", "outcome", "error_code", "input_text_tokens", "input_image_tokens",
		"output_text_tokens", "output_image_tokens", "cost_usd", "duration_ms", "user_id", "user_name", "source", "request_id", "provider_request_id", "employee_id"})
	for _, c := range calls {
		employee := ""
		if c.EmployeeID != nil {
			employee = c.EmployeeID.String()
		}
		_ = cw.Write([]string{c.At.Format(time.RFC3339), string(c.Operation), c.Model, string(c.Outcome), c.ErrorCode,
			strconv.Itoa(c.Tokens.InputText), strconv.Itoa(c.Tokens.InputImage), strconv.Itoa(c.Tokens.OutputText), strconv.Itoa(c.Tokens.OutputImage),
			strconv.FormatFloat(float64(c.CostMicroUSD)/1e6, 'f', 6, 64), strconv.Itoa(c.DurationMS), c.UserID.String(), c.UserName, c.Source, c.RequestID,
			c.ProviderRequestID, employee})
	}
	cw.Flush()
}

// colorizeAvailable tells Import Documents whether to offer Make Colour Photo
// (AI): {available}, without saying why not (Settings are the administrator's).
func (h *aiHandler) colorizeAvailable(w http.ResponseWriter, r *http.Request) {
	ok, err := h.colour.Available(r.Context())
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Available bool `json:"available"`
	}{ok})
}

// colorize takes the grey portrait (multipart "portrait", a JPEG, and the
// "employee_id" it is for) and answers its AI-coloured JPEG, kept nowhere.
func (h *aiHandler) colorize(w http.ResponseWriter, r *http.Request) {
	actor, err := actorID(r)
	if err != nil {
		writeError(w, r, err)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, colour.MaxBytes+64<<10)
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		writeError(w, r, colour.ErrNotPortrait)
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, err := r.FormFile("portrait")
	if err != nil {
		writeErrorMessage(w, http.StatusBadRequest, `send the portrait as multipart/form-data, in a part named portrait`)
		return
	}
	data, err := io.ReadAll(io.LimitReader(f, colour.MaxBytes+1))
	f.Close()
	if err != nil {
		writeError(w, r, err)
		return
	}
	var employee uuid.UUID
	if v := r.FormValue("employee_id"); v != "" {
		if employee, err = uuid.Parse(v); err != nil {
			writeError(w, r, errBadRequest)
			return
		}
	}
	jpg, err := h.colour.Colorize(r.Context(), data, employee, actor)
	if err != nil {
		writeError(w, r, err)
		return
	}
	writeNoStore(w)
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	w.Write(jpg)
}
