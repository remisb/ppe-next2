package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// stubReady answers Ready with err.
type stubReady struct{ err error }

func (s stubReady) Ready(context.Context) error { return s.err }

func TestReady(t *testing.T) {
	for _, tc := range []struct {
		name        string
		err         error
		wantStatus  int
		wantProblem string
	}{
		{"ready", nil, http.StatusOK, ""},
		{"database down", fmt.Errorf("%w: dial tcp: refused", errDatabaseUnreachable), http.StatusServiceUnavailable, "database"},
		{"migrations pending", fmt.Errorf("%w: 0099_next.up.sql", errMigrationsPending), http.StatusServiceUnavailable, "migrations"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			api := newTestAPI(t)
			api.svc.ready = stubReady{tc.err}
			api.handler = routes(testConfig(), api.svc, api.tokens, testLogger)
			rec := api.do(t, "GET", "/ready", "", nil)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.wantStatus, rec.Body)
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Error("/ready must not be cached")
			}
			var body map[string]string
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body["problem"] != tc.wantProblem || body["commit"] == "" {
				t.Errorf("body = %v", body)
			}
			// The route is public: the driver's error and migration names stay in the log.
			if strings.Contains(rec.Body.String(), "dial") || strings.Contains(rec.Body.String(), "0099") {
				t.Errorf("body leaks the detail: %s", rec.Body)
			}
		})
	}
}

func TestProbeReady(t *testing.T) {
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ready" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"status":"ready"}`))
	}))
	defer srv.Close()
	_, port, _ := strings.Cut(srv.Listener.Addr().String(), "127.0.0.1:")

	// The configured listen address has no host, as in the container.
	var out bytes.Buffer
	if err := probeReady(context.Background(), ":"+port, &out); err != nil {
		t.Fatalf("ready API: %v", err)
	}
	if !strings.Contains(out.String(), `"ready"`) {
		t.Errorf("output = %q, want the /ready answer", out.String())
	}
	status = http.StatusServiceUnavailable
	if err := probeReady(context.Background(), "0.0.0.0:"+port, &bytes.Buffer{}); err == nil {
		t.Error("a 503 must fail the probe")
	}
	if err := probeReady(context.Background(), "no-port", &bytes.Buffer{}); err == nil {
		t.Error("an address without a port must fail")
	}
}

func TestBuildCommitIsNeverEmpty(t *testing.T) {
	if buildCommit() == "" {
		t.Fatal("buildCommit() is empty")
	}
	old := commit
	t.Cleanup(func() { commit = old })
	commit = "6747260-dirty"
	if got := buildCommit(); got != "6747260-dirty" {
		t.Errorf("buildCommit() = %q, want the ldflags value", got)
	}
}
