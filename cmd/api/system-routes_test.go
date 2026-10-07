package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/remisb/ppe-next2/internal/domain/backup"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/overview"
	"github.com/remisb/ppe-next2/internal/system"
)

// failingBackups fails, or panics, when the backups are read.
type failingBackups struct{ panics bool }

func (f failingBackups) Read(context.Context, int) (backup.Status, error) {
	if f.panics {
		var m map[string]int
		m["boom"]++ // a nil map: a real panic
	}
	return backup.Status{}, errors.New("backup store: connection refused")
}

// withBackups serves the API with backups read from repo.
func (a *testAPI) withBackups(repo backup.Repository) {
	a.svc.backups = backup.NewService(repo)
	a.handler = routes(testConfig(), a.svc, a.tokens, testLogger)
}

// A 500 answers with the request's reference, and the error goes on the list
// with its route pattern, why it failed, who asked and from which app.
func TestServerErrorsAreRecorded(t *testing.T) {
	api := newTestAPI(t)
	admin, tok := api.userWith(t, role.KeyAdmin)
	api.withBackups(failingBackups{})

	req := httptest.NewRequest("GET", "/api/v1/backups", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set(appHeader, "admin")
	rec := httptest.NewRecorder()
	api.handler.ServeHTTP(rec, req)
	body := decode[map[string]string](t, rec.Body.Bytes())
	if rec.Code != 500 || body["error"] != "internal error" || body["reference"] == "" || body["reference"] != rec.Header().Get("X-Request-ID") {
		t.Fatalf("500 = %d %v, request id %q", rec.Code, body, rec.Header().Get("X-Request-ID"))
	}
	got := api.errors.recorded()
	if len(got) != 1 {
		t.Fatalf("recorded %d errors", len(got))
	}
	e := got[0]
	if e.Kind != system.KindServer || e.Route != "GET /api/v1/backups" || e.Method != "GET" || *e.Status != 500 ||
		e.Message != "backup store: connection refused" || *e.LastRequestID != body["reference"] ||
		*e.LastUserID != admin.ID || string(*e.Source) != "admin" {
		t.Errorf("recorded %+v", e)
	}
	// A 4xx is the client's mistake, not an error of the API's.
	api.do(t, "GET", "/api/v1/orders/not-a-uuid", tok, nil)
	api.do(t, "GET", "/api/v1/nowhere", tok, nil)
	if n := len(api.errors.recorded()); n != 1 {
		t.Errorf("4xx answers recorded: %d errors", n)
	}
}

// A handler's panic is answered 500 with a reference, recorded with its stack,
// and the API goes on serving: it runs on the Timeout middleware's goroutine,
// which the outer Recoverer cannot reach.
func TestPanicsAreRecovered(t *testing.T) {
	api := newTestAPI(t)
	_, tok := api.userWith(t, role.KeyAdmin)
	api.withBackups(failingBackups{panics: true})

	rec := api.do(t, "GET", "/api/v1/backups", tok, nil)
	if rec.Code != 500 || !strings.Contains(rec.Body.String(), `"reference":"`) {
		t.Fatalf("panic = %d %s", rec.Code, rec.Body)
	}
	e := api.errors.recorded()[0]
	if e.Kind != system.KindPanic || e.Route != "GET /api/v1/backups" || !strings.Contains(e.Message, "nil map") ||
		!strings.Contains(e.Stack, "failingBackups") {
		t.Errorf("recorded %+v", e)
	}
	if rec := api.do(t, "GET", "/api/v1/users/me", tok, nil); rec.Code != 200 {
		t.Errorf("after the panic: %d", rec.Code)
	}
}

// The apps report errors from the browser; the page's ids are dropped.
func TestClientErrors(t *testing.T) {
	api := newTestAPI(t)
	_, tok := api.userWith(t, role.KeyEmployee)
	b, _ := json.Marshal(map[string]string{
		"message": "TypeError: x is undefined", "stack": "at render (index.js:1:2)",
		"path": "/orders/6f1c0e4a-91d2-4b3e-8c55-0a3b2c1d4e5f?tab=record",
	})
	req := httptest.NewRequest("POST", "/api/v1/client-errors", bytes.NewReader(b))
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set(appHeader, "workwear")
	rec := httptest.NewRecorder()
	api.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("report = %d %s", rec.Code, rec.Body)
	}
	e := api.errors.recorded()[0]
	if e.Kind != system.KindClient || e.Route != "/orders/:id" || e.Status != nil || string(*e.Source) != "workwear" {
		t.Errorf("recorded %+v", e)
	}
	for _, body := range []any{map[string]string{"message": ""}, map[string]string{"message": "x", "colour": "red"}} {
		if rec := api.do(t, "POST", "/api/v1/client-errors", tok, body); rec.Code != 400 {
			t.Errorf("%v = %d, want 400", body, rec.Code)
		}
	}
	if rec := api.do(t, "POST", "/api/v1/client-errors", "", map[string]string{"message": "x"}); rec.Code != 401 {
		t.Errorf("signed out = %d, want 401", rec.Code)
	}
}

// The Overview shows each reader the areas their permissions open: an
// administrator everything, the employee role nothing.
func TestOverviewByPermission(t *testing.T) {
	api := newTestAPI(t)
	_, admin := api.userWith(t, role.KeyAdmin)
	_, employee := api.userWith(t, role.KeyEmployee)

	var o Overview
	rec := api.do(t, "GET", "/api/v1/overview", admin, nil)
	if err := json.Unmarshal(rec.Body.Bytes(), &o); err != nil || rec.Code != 200 {
		t.Fatalf("overview = %d %s", rec.Code, rec.Body)
	}
	if o.Users == nil || o.Users.Active < 2 || o.Security == nil || o.Requests == nil || o.Backups == nil {
		t.Errorf("an administrator's overview = %s", rec.Body)
	}
	// The test API has no backups and has never reviewed access: critical first.
	if len(o.Attention) != 2 || o.Attention[0].Key != overview.BackupsNotRunning || o.Attention[1].Key != overview.ReviewOverdue {
		t.Errorf("attention = %+v", o.Attention)
	}

	rec = api.do(t, "GET", "/api/v1/overview", employee, nil)
	if rec.Code != 200 || rec.Body.String() != `{"attention":[],"users":null,"security":null,"requests":null,"backups":null}`+"\n" {
		t.Errorf("the employee role's overview = %d %s", rec.Code, rec.Body)
	}

	rec = api.do(t, "GET", "/api/v1/system/status", admin, nil)
	var st SystemStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil || rec.Code != 200 || !st.Service.Ready || st.Service.GoVersion == "" ||
		st.Retention.ErrorEventsDays != 30 || st.Requests.Requests < 2 {
		t.Errorf("status = %d %s", rec.Code, rec.Body)
	}
}

func TestSystemErrorsRejectUnknownParameters(t *testing.T) {
	api := newTestAPI(t)
	_, tok := api.userWith(t, role.KeyAdmin)
	for _, q := range []string{"?colour=red", "?kind=oops", "?kind=server&kind=panic", "?after=zzz", "?page_size=x"} {
		if rec := api.do(t, "GET", "/api/v1/system/errors"+q, tok, nil); rec.Code != 400 {
			t.Errorf("%s = %d, want 400", q, rec.Code)
		}
	}
	if rec := api.do(t, "GET", "/api/v1/system/errors?kind=client", tok, nil); rec.Body.String() != `{"errors":[],"next":null}`+"\n" {
		t.Errorf("empty list = %s", rec.Body)
	}
}

// Every log line written with a request's context carries its ID.
func TestLogLinesNameTheRequest(t *testing.T) {
	api := newTestAPI(t)
	var buf bytes.Buffer
	logger := slog.New(requestIDHandler{slog.NewJSONHandler(&buf, nil)})
	api.handler = routes(testConfig(), api.svc, api.tokens, logger)
	rec := api.do(t, "GET", "/health", "", nil)
	id := rec.Header().Get("X-Request-ID")
	if id == "" || !strings.Contains(buf.String(), `"request_id":"`+id+`"`) {
		t.Errorf("log = %s, request %q", buf.String(), id)
	}
}

// blockingBackups waits until the request ends.
type blockingBackups struct{}

func (blockingBackups) Read(ctx context.Context, _ int) (backup.Status, error) {
	<-ctx.Done()
	return backup.Status{}, ctx.Err()
}

// A client that goes away (a closed tab) is not the API's error: nothing goes
// on the list, though the request is still counted.
func TestAbandonedRequestsAreNotErrors(t *testing.T) {
	api := newTestAPI(t)
	_, tok := api.userWith(t, role.KeyAdmin)
	api.withBackups(blockingBackups{})
	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest("GET", "/api/v1/backups", nil).WithContext(ctx)
	req.Header.Set("Authorization", "Bearer "+tok)
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()
	api.handler.ServeHTTP(httptest.NewRecorder(), req)
	if n := len(api.errors.recorded()); n != 0 {
		t.Errorf("an abandoned request recorded %d errors: %+v", n, api.errors.recorded())
	}
	if got := api.svc.window.Snapshot(time.Now()); got.Errors != 0 {
		t.Errorf("the window counts it as an error: %+v", got.Counts)
	}
}
