package monitor

import (
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Metrics are the API's Prometheus metrics, served on the internal listener
// (API_METRICS_ADDR) that Caddy never proxies. Nothing scrapes them yet: they
// are there for curl during an incident and for a monitoring stack later.
type Metrics struct {
	registry  *prometheus.Registry
	requests  *prometheus.CounterVec
	durations *prometheus.HistogramVec
	signIns   *prometheus.CounterVec
	errors    *prometheus.CounterVec
}

// NewMetrics registers the Go runtime and process collectors and the API's
// own metrics. pool, when not nil, adds the database pool's figures.
func NewMetrics(pool *pgxpool.Pool) *Metrics {
	m := &Metrics{
		registry: prometheus.NewRegistry(),
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "ppe_http_requests_total",
			Help: "HTTP requests by route pattern, method and status.",
		}, []string{"route", "method", "status"}),
		durations: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "ppe_http_request_duration_seconds",
			Help:    "HTTP request latency by route pattern.",
			Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10},
		}, []string{"route"}),
		signIns: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "ppe_sign_in_failures_total",
			Help: "Failed sign-ins and password confirmations by reason.",
		}, []string{"reason"}),
		errors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "ppe_error_events_total",
			Help: "Errors recorded on the System screen's list, by kind (server, panic, client).",
		}, []string{"kind"}),
	}
	m.registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		m.requests, m.durations, m.signIns, m.errors,
	)
	if pool != nil {
		m.registry.MustRegister(poolCollector{pool})
	}
	return m
}

// ObserveRequest counts one request.
func (m *Metrics) ObserveRequest(route, method string, status int, d time.Duration) {
	m.requests.WithLabelValues(route, method, strconv.Itoa(status)).Inc()
	m.durations.WithLabelValues(route).Observe(d.Seconds())
}

// SignInFailed counts a refused sign-in or password confirmation.
func (m *Metrics) SignInFailed(reason string) { m.signIns.WithLabelValues(reason).Inc() }

// ErrorRecorded counts an error put on the error list.
func (m *Metrics) ErrorRecorded(kind string) { m.errors.WithLabelValues(kind).Inc() }

// Handler serves the metrics in Prometheus's text format.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}

// poolCollector reads the pgx pool's figures at each scrape.
type poolCollector struct{ pool *pgxpool.Pool }

var (
	poolConns = prometheus.NewDesc("ppe_db_pool_connections", "Database pool connections by state.", []string{"state"}, nil)
	poolMax   = prometheus.NewDesc("ppe_db_pool_max_connections", "The pool's connection limit (API_DB_MAX_CONNS).", nil, nil)
	poolWaits = prometheus.NewDesc("ppe_db_pool_waits_total", "Acquires that waited for a free connection.", nil, nil)
	poolWait  = prometheus.NewDesc("ppe_db_pool_wait_seconds_total", "Time spent waiting for a free connection.", nil, nil)
)

func (c poolCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- poolConns
	ch <- poolMax
	ch <- poolWaits
	ch <- poolWait
}

func (c poolCollector) Collect(ch chan<- prometheus.Metric) {
	s := c.pool.Stat()
	ch <- prometheus.MustNewConstMetric(poolConns, prometheus.GaugeValue, float64(s.AcquiredConns()), "acquired")
	ch <- prometheus.MustNewConstMetric(poolConns, prometheus.GaugeValue, float64(s.IdleConns()), "idle")
	ch <- prometheus.MustNewConstMetric(poolConns, prometheus.GaugeValue, float64(s.ConstructingConns()), "constructing")
	ch <- prometheus.MustNewConstMetric(poolMax, prometheus.GaugeValue, float64(s.MaxConns()))
	ch <- prometheus.MustNewConstMetric(poolWaits, prometheus.CounterValue, float64(s.EmptyAcquireCount()))
	ch <- prometheus.MustNewConstMetric(poolWait, prometheus.CounterValue, s.EmptyAcquireWaitTime().Seconds())
}
