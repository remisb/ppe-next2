package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/remisb/ppe-next2/internal/aiusage"
	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/personnel/colour"
	"github.com/remisb/ppe-next2/internal/sealbox"
)

// memAI keeps the ledger and Settings → AI in memory, for the route tests.
type memAI struct {
	mu    sync.Mutex
	calls []aiusage.Call
	row   aiusage.SettingsRow
	found bool
	evs   []audit.Event
}

func (m *memAI) Insert(_ context.Context, c aiusage.Call) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, c)
	return nil
}

func (m *memAI) CostSince(_ context.Context, from time.Time) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var sum int64
	for _, c := range m.calls {
		if !c.At.Before(from) {
			sum += c.CostMicroUSD
		}
	}
	return sum, nil
}

func (m *memAI) Settings(context.Context) (aiusage.SettingsRow, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.row, m.found, nil
}

func (m *memAI) UpdateSettings(_ context.Context, mutate func(aiusage.SettingsRow) (aiusage.SettingsRow, []audit.Event, error)) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cur := m.row
	if !m.found {
		cur = aiusage.SettingsRow{Settings: aiusage.DefaultSettings()}
	}
	next, evs, err := mutate(cur)
	if err != nil || len(evs) == 0 {
		return err
	}
	m.row, m.found = next, true
	m.evs = append(m.evs, evs...)
	return nil
}

func (m *memAI) Sums(context.Context, time.Time, string) ([]aiusage.MonthSum, []aiusage.KeySum, []aiusage.KeySum, []aiusage.KeySum, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var s aiusage.Sum
	for _, c := range m.calls {
		s.Calls++
		s.CostMicroUSD += c.CostMicroUSD
	}
	month := time.Now().UTC().Format("2006-01")
	return []aiusage.MonthSum{{Month: month, Sum: s}}, []aiusage.KeySum{}, []aiusage.KeySum{}, []aiusage.KeySum{}, nil
}

func (m *memAI) Calls(context.Context, aiusage.Filter) ([]aiusage.Call, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]aiusage.Call{}, m.calls...), nil
}

// fakeOpenAIChecker takes keys that start with "sk-good".
type fakeOpenAIChecker struct{}

func (fakeOpenAIChecker) Check(_ context.Context, key string) error {
	if strings.HasPrefix(key, "sk-good") {
		return nil
	}
	return &colour.Error{Status: 401, Code: "invalid_api_key"}
}

// fakeColourer answers a tinted picture, as a model would, with its usage.
type fakeColourer struct{}

func (fakeColourer) Colorize(_ context.Context, _ colour.Edit, grey image.Image) (image.Image, aiusage.Result, error) {
	b := grey.Bounds()
	img := image.NewRGBA(image.Rect(0, 0, 1024, 1536))
	for y := range 1536 {
		for x := range 1024 {
			img.Set(x, y, color.RGBA{R: 210, G: 160, B: 120, A: 255})
		}
	}
	_ = b
	return img, aiusage.Result{Tokens: aiusage.Tokens{InputImage: 1000, OutputImage: 4160}, ProviderRequestID: "req_fake"}, nil
}

func newTestAI() *aiHandler {
	store := &memAI{}
	ring, err := sealbox.NewKeyring(1, map[int16][]byte{1: bytes.Repeat([]byte{3}, sealbox.KeySize)})
	if err != nil {
		panic(err)
	}
	settings := aiusage.NewSettingsService(store, ring)
	ledger := aiusage.NewService(store)
	return &aiHandler{settings: settings, ledger: ledger, report: store, checker: fakeOpenAIChecker{}, colour: colour.NewService(settings, ledger, fakeColourer{})}
}

func portraitJPEG(t *testing.T) []byte {
	t.Helper()
	img := image.NewGray(image.Rect(0, 0, 60, 80))
	for y := range 80 {
		for x := range 60 {
			img.SetGray(x, y, color.Gray{Y: uint8(40 + x*2)})
		}
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func (a *testAPI) colorize(t *testing.T, token string, portrait []byte) *httptest.ResponseRecorder {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, _ := mw.CreateFormFile("portrait", "portrait.jpg")
	fw.Write(portrait)
	mw.Close()
	req := httptest.NewRequest("POST", "/api/v1/personnel/portraits/colorize", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	a.handler.ServeHTTP(rec, req)
	return rec
}

// Settings → AI, the key that is never read back, colouring and its ledger.
func TestAISettingsKeyAndColouring(t *testing.T) {
	api := newTestAPI(t)
	_, admin := api.userWith(t, role.KeyAdmin)
	colourer := api.tokenWith(t, role.PersonnelPortraitsColorize)

	rec := api.do(t, "GET", "/api/v1/settings/ai", admin, nil)
	got := decode[map[string]any](t, rec.Body.Bytes())
	if rec.Code != 200 || got["enabled"] != false || got["model"] != "gpt-image-2" || got["can_save_key"] != true || got["key"] != nil {
		t.Fatalf("settings = %d %s", rec.Code, rec.Body)
	}
	available := func() string {
		return api.do(t, "GET", "/api/v1/personnel/portraits/colorize", colourer, nil).Body.String()
	}
	if got := available(); !strings.Contains(got, `"available":false`) {
		t.Errorf("available while off = %s", got)
	}
	// Colouring while it is off, then without a key.
	if rec := api.colorize(t, colourer, portraitJPEG(t)); rec.Code != http.StatusConflict {
		t.Errorf("colour while off = %d %s", rec.Code, rec.Body)
	}
	rec = api.do(t, "PUT", "/api/v1/settings/ai", admin, map[string]any{"enabled": true, "model": "gpt-image-2", "quality": "low",
		"prices": map[string]any{"gpt-image-2": map[string]any{"input_text": 5, "input_image": 8, "output_text": 0, "output_image": 30}}, "budget_micro_usd": 1_000_000})
	if rec.Code != 200 {
		t.Fatalf("update = %d %s", rec.Code, rec.Body)
	}
	if rec := api.colorize(t, colourer, portraitJPEG(t)); rec.Code != http.StatusConflict {
		t.Errorf("colour without a key = %d %s", rec.Code, rec.Body)
	}
	// A key OpenAI refuses is not saved; a good one is, and only its end is ever shown.
	if rec := api.do(t, "PUT", "/api/v1/settings/ai/key", admin, map[string]any{"key": "sk-bad-0123456789abcdefgh"}); rec.Code != http.StatusBadRequest {
		t.Errorf("a refused key = %d %s", rec.Code, rec.Body)
	}
	const key = "sk-good-0123456789abcdef4f2a"
	rec = api.do(t, "PUT", "/api/v1/settings/ai/key", admin, map[string]any{"key": key})
	if rec.Code != 200 || strings.Contains(rec.Body.String(), "0123456789") || !strings.Contains(rec.Body.String(), `"last4":"4f2a"`) {
		t.Fatalf("set key = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/settings/ai", admin, nil); strings.Contains(rec.Body.String(), "0123456789") || rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("settings show the key: %s", rec.Body)
	}
	if rec := api.do(t, "POST", "/api/v1/settings/ai/key/test", admin, map[string]any{}); !strings.Contains(rec.Body.String(), `"ok":true`) {
		t.Errorf("test key = %d %s", rec.Code, rec.Body)
	}

	if got := available(); !strings.Contains(got, `"available":true`) {
		t.Errorf("available with a key = %s", got)
	}
	// Colouring: a JPEG of the portrait's size, not cached; recorded with its cost.
	rec = api.colorize(t, colourer, portraitJPEG(t))
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/jpeg" || rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("colour = %d %s", rec.Code, rec.Body)
	}
	img, err := jpeg.Decode(bytes.NewReader(rec.Body.Bytes()))
	if err != nil || img.Bounds().Dx() != 60 || img.Bounds().Dy() != 80 {
		t.Errorf("answer = %v, %v", err, img)
	}
	if rec := api.colorize(t, colourer, []byte("not a picture")); rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("not a JPEG = %d", rec.Code)
	}
	rec = api.do(t, "GET", "/api/v1/ai-usage/calls", admin, nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"operation":"portrait.colorize"`) || !strings.Contains(rec.Body.String(), `"cost_micro_usd":132800`) ||
		strings.Contains(rec.Body.String(), "sk-good") {
		t.Errorf("calls = %d %s", rec.Code, rec.Body)
	}
	rec = api.do(t, "GET", "/api/v1/ai-usage", admin, nil)
	if r := decode[map[string]any](t, rec.Body.Bytes()); rec.Code != 200 || r["budget_micro_usd"] != float64(1_000_000) {
		t.Errorf("report = %d %s", rec.Code, rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/ai-usage/calls.csv", admin, nil); !strings.HasPrefix(rec.Body.String(), "at,operation,model") || !strings.Contains(rec.Body.String(), "0.132800") {
		t.Errorf("csv = %s", rec.Body)
	}
	if rec := api.do(t, "GET", "/api/v1/ai-usage/calls?from=yesterday", admin, nil); rec.Code != http.StatusBadRequest {
		t.Errorf("a bad filter = %d", rec.Code)
	}
	// Removing the key stops colouring.
	if rec := api.do(t, "DELETE", "/api/v1/settings/ai/key", admin, nil); rec.Code != 200 {
		t.Fatalf("remove key = %d %s", rec.Code, rec.Body)
	}
	if rec := api.colorize(t, colourer, portraitJPEG(t)); rec.Code != http.StatusConflict {
		t.Errorf("colour after removal = %d", rec.Code)
	}
	if got := available(); !strings.Contains(got, `"available":false`) {
		t.Errorf("available after removal = %s", got)
	}
}

func TestSecretsKeyErrors(t *testing.T) {
	ok := config{JWTSecret: strings.Repeat("s", 32), SIMCodesKey: strings.Repeat("ab", 32), SecretsKeyID: 1}
	if errs := ok.secretsKeyErrors(); len(errs) != 0 {
		t.Errorf("none set = %v", errs)
	}
	on := ok
	on.SecretsKey = strings.Repeat("cd", 32)
	if errs := on.secretsKeyErrors(); len(errs) != 0 {
		t.Errorf("a key = %v", errs)
	}
	for name, change := range map[string]func(c *config){
		"short":             func(c *config) { c.SecretsKey = "abcd" },
		"the SIM codes key": func(c *config) { c.SecretsKey = c.SIMCodesKey },
		"previous is it":    func(c *config) { c.SecretsPreviousKeys = "2:" + c.SecretsKey },
	} {
		c := on
		change(&c)
		if errs := c.secretsKeyErrors(); len(errs) == 0 {
			t.Errorf("%s: no error", name)
		}
	}
	if ring, err := secretsKeyring(ok); err != nil || ring != nil {
		t.Errorf("no key = %v, %v", ring, err)
	}
}
