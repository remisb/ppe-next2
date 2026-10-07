package monitor

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWindow(t *testing.T) {
	start := time.Date(2026, 10, 7, 9, 0, 0, 0, time.UTC)
	w := NewWindow(start)
	for i := range 100 {
		w.Observe("GET /api/v1/orders", 200, time.Duration(i+1)*time.Millisecond, start.Add(time.Minute))
	}
	w.Observe("GET /api/v1/orders", 500, time.Second, start.Add(6*time.Minute))
	w.Observe("POST /api/v1/orders", 201, 3*time.Second, start.Add(2*time.Hour))

	got := w.Snapshot(start.Add(2*time.Hour + time.Minute))
	if !got.Since.Equal(start) || got.Requests != 102 || got.Errors != 1 {
		t.Fatalf("since %v, %d requests, %d errors", got.Since, got.Requests, got.Errors)
	}
	if len(got.Series) != 25 || got.Series[0].Requests != 100 || got.Series[1].Errors != 1 || got.Series[24].Requests != 1 {
		t.Errorf("series = %d points: %+v", len(got.Series), got.Series[:2])
	}
	// The last hour holds only the POST.
	if got.LastHour != (Counts{Requests: 1}) {
		t.Errorf("last hour = %+v", got.LastHour)
	}
	// 102 requests: the 51st and the 97th both fall in the 50–100 ms bin.
	if got.P50Ms != 100 || got.P95Ms != 100 {
		t.Errorf("p50 %v, p95 %v", got.P50Ms, got.P95Ms)
	}
	if len(got.Slowest) != 2 || got.Slowest[0].Route != "POST /api/v1/orders" || got.Slowest[0].P95Ms != 5000 ||
		got.Slowest[1].Requests != 101 || got.Slowest[1].Errors != 1 {
		t.Errorf("slowest = %+v", got.Slowest)
	}

	// A day later the old buckets have left the window, and their slots are reused.
	later := start.Add(26 * time.Hour)
	w.Observe("GET /health", 200, time.Millisecond, later)
	got = w.Snapshot(later)
	if got.Requests != 1 || len(got.Series) != buckets || !got.Since.Equal(later.Add(-Span).Truncate(Step).Add(Step)) {
		t.Errorf("a day later: %d requests, %d points since %v", got.Requests, len(got.Series), got.Since)
	}
}

func TestMetricsServeTheirFormat(t *testing.T) {
	m := NewMetrics(nil)
	m.ObserveRequest("GET /api/v1/orders", "GET", 200, 30*time.Millisecond)
	m.SignInFailed("bad_password")
	m.ErrorRecorded("panic")
	rec := httptest.NewRecorder()
	m.Handler().ServeHTTP(rec, httptest.NewRequest("GET", "/metrics", nil))
	body, _ := io.ReadAll(rec.Body)
	for _, want := range []string{
		`ppe_http_requests_total{method="GET",route="GET /api/v1/orders",status="200"} 1`,
		`ppe_sign_in_failures_total{reason="bad_password"} 1`,
		`ppe_error_events_total{kind="panic"} 1`,
		"go_goroutines",
	} {
		if !strings.Contains(string(body), want) {
			t.Errorf("metrics lack %s", want)
		}
	}
}
