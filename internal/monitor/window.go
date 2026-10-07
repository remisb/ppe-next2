// Package monitor keeps the API's own figures: a rolling 24-hour window of
// requests for the System screen and the Overview (Window), and the Prometheus
// metrics on the internal listener (Metrics). Both are fed by one middleware
// in cmd/api and live in memory: a restart starts them again, which is fine
// for a status view. History belongs to a monitoring stack (proposal 5.3).
package monitor

import (
	"slices"
	"sort"
	"sync"
	"time"
)

const (
	// Step is one bucket of the window.
	Step = 5 * time.Minute
	// Span is how far back the window reaches.
	Span    = 24 * time.Hour
	buckets = int(Span / Step)
)

// bounds are the latency histogram's upper bounds in milliseconds; a
// percentile reads as the bound of the bin it falls in, which is close enough
// for a status view.
var bounds = []float64{1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000}

type histogram [14]int // len(bounds)+1: the last bin is over the highest bound

func (h *histogram) add(ms float64) {
	h[sort.SearchFloat64s(bounds, ms)]++
}

func (h *histogram) merge(o *histogram) {
	for i := range h {
		h[i] += o[i]
	}
}

// quantile is the bound of the bin holding the q-th request; 0 for none.
func (h *histogram) quantile(q float64) float64 {
	total := 0
	for _, n := range h {
		total += n
	}
	if total == 0 {
		return 0
	}
	rank := int(q*float64(total-1)) + 1
	seen := 0
	for i, n := range h {
		seen += n
		if seen >= rank {
			if i < len(bounds) {
				return bounds[i]
			}
			return bounds[len(bounds)-1] * 2
		}
	}
	return 0
}

type tally struct {
	requests int
	errors   int
	latency  histogram
}

func (t *tally) add(o *tally) {
	t.requests += o.requests
	t.errors += o.errors
	t.latency.merge(&o.latency)
}

type bucket struct {
	start  time.Time // zero when unused
	all    tally
	routes map[string]*tally
}

// Window counts requests in 5-minute buckets over the last 24 hours, in total
// and per route pattern. It is safe for concurrent use.
type Window struct {
	mu      sync.Mutex
	started time.Time
	ring    [buckets]bucket
}

// NewWindow starts an empty window at started.
func NewWindow(started time.Time) *Window { return &Window{started: started} }

// Observe counts one request to route (the ServeMux pattern) that answered
// status after d. 5xx answers are errors.
func (w *Window) Observe(route string, status int, d time.Duration, at time.Time) {
	start := at.Truncate(Step)
	ms := float64(d) / float64(time.Millisecond)
	w.mu.Lock()
	defer w.mu.Unlock()
	b := &w.ring[int(start.Unix()/int64(Step/time.Second))%buckets]
	if !b.start.Equal(start) {
		*b = bucket{start: start, routes: map[string]*tally{}}
	}
	one := tally{requests: 1}
	if status >= 500 {
		one.errors = 1
	}
	one.latency.add(ms)
	b.all.add(&one)
	r := b.routes[route]
	if r == nil {
		r = &tally{}
		b.routes[route] = r
	}
	r.add(&one)
}

// Point is one 5-minute bucket.
type Point struct {
	At       time.Time `json:"at"`
	Requests int       `json:"requests"`
	Errors   int       `json:"errors"`
	P95Ms    float64   `json:"p95_ms"`
}

// RouteStat is one route over the window.
type RouteStat struct {
	Route    string  `json:"route"`
	Requests int     `json:"requests"`
	Errors   int     `json:"errors"`
	P50Ms    float64 `json:"p50_ms"`
	P95Ms    float64 `json:"p95_ms"`
}

// Counts are requests and the 5xx among them.
type Counts struct {
	Requests int `json:"requests"`
	Errors   int `json:"errors"`
}

// Requests is the window as the System screen shows it.
type Requests struct {
	// Since is when the window begins: 24 hours ago, or when the API started
	// if that is later.
	Since time.Time `json:"since"`
	Counts
	P50Ms float64 `json:"p50_ms"`
	P95Ms float64 `json:"p95_ms"`
	// LastHour is the last 60 minutes, for the Overview's error rate.
	LastHour Counts `json:"last_hour"`
	// Series has a point for every bucket since Since, oldest first.
	Series []Point `json:"series"`
	// Slowest are up to SlowestLimit routes by 95th percentile, slowest first.
	Slowest []RouteStat `json:"slowest"`
}

// SlowestLimit is how many routes Requests.Slowest lists.
const SlowestLimit = 8

// Snapshot reads the window at now.
func (w *Window) Snapshot(now time.Time) Requests {
	w.mu.Lock()
	defer w.mu.Unlock()
	since := now.Add(-Span).Truncate(Step).Add(Step)
	if w.started.After(since) {
		since = w.started.Truncate(Step)
	}
	out := Requests{Since: since, Series: []Point{}, Slowest: []RouteStat{}}
	var all tally
	routes := map[string]*tally{}
	hourAgo := now.Add(-time.Hour)
	for t := since; !t.After(now); t = t.Add(Step) {
		b := &w.ring[int(t.Unix()/int64(Step/time.Second))%buckets]
		p := Point{At: t}
		if b.start.Equal(t) {
			p.Requests, p.Errors, p.P95Ms = b.all.requests, b.all.errors, b.all.latency.quantile(0.95)
			all.add(&b.all)
			for name, r := range b.routes {
				if routes[name] == nil {
					routes[name] = &tally{}
				}
				routes[name].add(r)
			}
			if t.Add(Step).After(hourAgo) {
				out.LastHour.Requests += b.all.requests
				out.LastHour.Errors += b.all.errors
			}
		}
		out.Series = append(out.Series, p)
	}
	out.Requests, out.Errors = all.requests, all.errors
	out.P50Ms, out.P95Ms = all.latency.quantile(0.5), all.latency.quantile(0.95)
	for name, r := range routes {
		out.Slowest = append(out.Slowest, RouteStat{
			Route: name, Requests: r.requests, Errors: r.errors,
			P50Ms: r.latency.quantile(0.5), P95Ms: r.latency.quantile(0.95),
		})
	}
	slices.SortFunc(out.Slowest, func(a, b RouteStat) int {
		switch {
		case a.P95Ms != b.P95Ms:
			if a.P95Ms > b.P95Ms {
				return -1
			}
			return 1
		case a.Requests != b.Requests:
			return b.Requests - a.Requests
		}
		if a.Route < b.Route {
			return -1
		}
		return 1
	})
	if len(out.Slowest) > SlowestLimit {
		out.Slowest = out.Slowest[:SlowestLimit]
	}
	return out
}
