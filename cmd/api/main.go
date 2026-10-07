// Command api serves the PPE-next2 HTTP API.
package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/db"
	"github.com/remisb/ppe-next2/internal/domain/backup"
	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/dashboard"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/domain/session"
	"github.com/remisb/ppe-next2/internal/domain/settings"
	"github.com/remisb/ppe-next2/internal/domain/user"
	"github.com/remisb/ppe-next2/internal/monitor"
	"github.com/remisb/ppe-next2/internal/security"
	"github.com/remisb/ppe-next2/internal/system"
	"github.com/remisb/ppe-next2/internal/usage"
)

func main() {
	logger := slog.New(requestIDHandler{slog.NewJSONHandler(os.Stdout, nil)})
	slog.SetDefault(logger)
	if err := run(context.Background(), os.Args[1:], logger); err != nil {
		logger.Error("api stopped", slog.Any("error", err))
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, logger *slog.Logger) error {
	cfg, err := loadConfig(args)
	if err != nil {
		return err
	}
	if err := cfg.validate(); err != nil {
		return err
	}

	if cfg.Healthcheck {
		return probeReady(ctx, cfg.Addr, os.Stdout)
	}

	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := openDB(ctx, cfg)
	if err != nil {
		return err
	}
	defer pool.Close()

	loc, err := cfg.location()
	if err != nil {
		return err
	}
	sessions := session.NewService(session.NewPostgresRepository(pool), sessionKey(cfg.JWTSecret), sessionLimits(cfg))
	roles := role.NewService(role.NewPostgresRepository(pool))
	svc := newServices(
		loc, cfg.ConfirmTTL, cfg.AuditRetention,
		sessions,
		security.NewService(security.NewPostgresStore(pool), securityConfig(cfg), security.WithLocation(loc)),
		roles,
		user.NewService(user.NewPostgresRepository(pool), user.WithSessions(userSessions{sessions}),
			user.WithRoles(roles), user.WithGuardRole(role.AdminID)),
		employee.NewPostgresRepository(pool),
		catalogue.NewPostgresRepository(pool),
		itemset.NewPostgresRepository(pool),
		order.NewPostgresRepository(pool),
		dashboard.NewPostgresRepository(pool),
		settings.NewPostgresRepository(pool),
		backup.NewPostgresRepository(pool),
		audit.NewPostgresStore(pool),
		system.NewPostgresStore(pool),
		usage.NewPostgresStore(pool),
		pool,
	)
	svc.ready = dbReadiness{pool: pool, want: db.Migrations()}

	if cfg.SeedAdmin {
		return seedAdmin(ctx, pool, svc.users, cfg, logger)
	}
	if cfg.SeedDemo {
		return seedDemo(ctx, pool, svc.users, cfg, loc, logger)
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           routes(cfg, svc, newTokens(cfg), logger),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      cfg.RequestTimeout + 5*time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// Bind before logging so "listening" is only reported once the port is ours.
	ln, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return err
	}
	logger.Info("listening", slog.String("addr", ln.Addr().String()), slog.String("commit", buildCommit()))
	errc := make(chan error, 2)
	go func() { errc <- srv.Serve(ln) }()
	var metricsSrv *http.Server
	if cfg.MetricsAddr != "" {
		// Its own listener, which Caddy never proxies: the metrics are for the host only.
		metricsSrv = &http.Server{Addr: cfg.MetricsAddr, Handler: svc.metrics.Handler(), ReadHeaderTimeout: 5 * time.Second}
		mln, err := net.Listen("tcp", cfg.MetricsAddr)
		if err != nil {
			return err
		}
		logger.Info("metrics listening", slog.String("addr", mln.Addr().String()))
		go func() { errc <- metricsSrv.Serve(mln) }()
	}
	go runJobs(ctx, svc, logger)

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	if metricsSrv != nil {
		_ = metricsSrv.Shutdown(shutdownCtx)
	}
	return srv.Shutdown(shutdownCtx)
}

// services are the domain services the API exposes.
type services struct {
	sessions  *session.Service
	security  *security.Service
	roles     *role.Service
	users     *user.Service
	employees *employee.Service
	catalogue *catalogue.Service
	itemSets  *itemset.Service
	orders    *order.Service
	dashboard *dashboard.Service
	settings  *settings.Service
	backups   *backup.Service
	audit     *audit.Service
	// system is the error list and the database's status; window and
	// metrics are the API's own request figures (internal/monitor).
	system  *system.Service
	window  *monitor.Window
	metrics *monitor.Metrics
	// pool is the database pool, for System's figures; nil in tests.
	pool    *pgxpool.Pool
	started time.Time
	jobs    *jobRuns
	usage   *usage.Service
	// ready answers GET /ready; run sets it, tests stub it.
	ready readiness
}

// newServices builds every service from its repository and wires the
// cross-domain adapters in checkers.go.
func newServices(loc *time.Location, confirmTTL, auditRetention time.Duration, sessions *session.Service, sec *security.Service, roles *role.Service, users *user.Service, employees employee.Repository, items catalogue.Repository, sets itemset.Repository, orders order.Repository, board dashboard.Repository, prefs settings.Repository, backups backup.Repository, trail audit.Store, sys system.Store, use usage.Store, pool *pgxpool.Pool) services {
	metrics := monitor.NewMetrics(pool)
	s := services{
		sessions:  sessions,
		security:  sec,
		roles:     roles,
		users:     users,
		employees: employee.NewService(employees),
		catalogue: catalogue.NewService(items),
		dashboard: dashboard.NewService(board, dashboard.WithLocation(loc)),
		settings:  settings.NewService(prefs),
		backups:   backup.NewService(backups, backup.WithLocation(loc)),
		audit:     audit.NewService(trail, audit.WithLocation(loc), audit.WithRetention(auditRetention)),
		system:    system.NewService(sys, system.WithRecorded(func(k system.Kind) { metrics.ErrorRecorded(string(k)) })),
		window:    newWindow(),
		metrics:   metrics,
		pool:      pool,
		started:   time.Now().UTC(),
		jobs:      &jobRuns{},
		usage:     usage.NewService(use, usage.WithLocation(loc)),
	}
	s.itemSets = itemset.NewService(sets, catalogueChecker{s.catalogue})
	s.orders = order.NewService(orders, order.Readers{
		Employees: orderEmployees{s.employees},
		Catalogue: orderCatalogue{s.catalogue},
		ItemSets:  orderItemSets{s.itemSets},
	}, order.WithLocation(loc), order.WithConfirmTTL(confirmTTL))
	return s
}

// buildRouter is the single composition point: every route is mounted here.
func buildRouter(cfg config, svc services, tok *tokens) *router {
	rt := newRouter(tok.verify)
	rt.public("GET /health", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}))
	rt.public("GET /ready", readyHandler(svc.ready))
	registerAuthRoutes(rt, svc, tok, cfg)
	sensitive := requireSensitive(tok, cfg.RecentSignIn, svc.roles)
	registerSecurityRoutes(rt, svc, sensitive)
	registerUserRoutes(rt, svc.users, tok, sensitive)
	registerRoleRoutes(rt, svc.roles, sensitive)
	registerEmployeeRoutes(rt, svc.employees)
	registerCatalogueRoutes(rt, svc.catalogue)
	registerItemSetRoutes(rt, svc.itemSets)
	registerOrderRoutes(rt, svc.orders)
	registerConfirmationRoutes(rt, svc.orders, cfg.PublicBaseURL)
	registerDashboardRoutes(rt, svc.dashboard)
	registerSettingsRoutes(rt, svc.settings, cfg.OrgTimezone)
	registerBackupRoutes(rt, svc.backups)
	registerAuditRoutes(rt, svc)
	registerSystemRoutes(rt, svc, cfg, tok)
	rt.restricted("GET /api/v1/usage", func(w http.ResponseWriter, r *http.Request) {
		report, err := svc.usage.Report(r.Context())
		if err != nil {
			writeError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, report)
	}, role.UsageRead)
	return rt
}

// routes wraps the router in the global middleware.
func routes(cfg config, svc services, tok *tokens, logger *slog.Logger) http.Handler {
	mux := buildRouter(cfg, svc, tok).mux

	global := []middleware.Middleware{
		middleware.Recoverer(logger),
		// Before Logger and the rate limiters, which read the client it resolves.
		middleware.ClientIP(middleware.ClientIPConfig{TrustedProxies: cfg.TrustedProxies}),
		requestContext(tok),
		middleware.Logger(logger),
		observe(svc, logger),
	}
	if len(cfg.AllowedOrigins) > 0 {
		cors := middleware.DefaultCORSConfig()
		cors.AllowedOrigins = cfg.AllowedOrigins
		cors.AllowedHeaders = append(cors.AllowedHeaders, appHeader)
		global = append(global, middleware.CORS(cors))
	}
	// capturePanics inside Timeout, whose goroutine runs the handler.
	global = append(global, middleware.Timeout(cfg.RequestTimeout), capturePanics(logger))
	return middleware.Chain(mux, global...)
}

// sessionKey derives the key that signs refresh tokens from the JWT secret, so
// one secret signs both while neither key can stand in for the other. A new
// API_JWT_SECRET signs everyone out.
func sessionKey(secret string) []byte {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte("ppe-next2 refresh tokens v1"))
	return h.Sum(nil)
}

// securityConfig is the security log's policy: the per-email sign-in limit,
// the retention, and the key of the email hash, derived from the JWT secret as
// sessionKey is, under a label of its own.
func securityConfig(cfg config) security.Config {
	h := hmac.New(sha256.New, []byte(cfg.JWTSecret))
	h.Write([]byte("ppe-next2 sign-in emails v1"))
	return security.Config{
		Key: h.Sum(nil), Failures: cfg.LoginEmailFailures, Interval: cfg.LoginEmailInterval,
		Retention: cfg.AuthEventsRetention,
	}
}

func sessionLimits(cfg config) session.Limits {
	return session.Limits{MaxAge: cfg.SessionMaxAge, KeepMaxAge: cfg.SessionKeepMaxAge, KeepIdle: cfg.SessionKeepIdle}
}

func openDB(ctx context.Context, cfg config) (*pgxpool.Pool, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DBDSN)
	if err != nil {
		return nil, fmt.Errorf("parse API_DB_DSN: %w", err)
	}
	pcfg.MaxConns = int32(cfg.DBMaxConns)
	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database unreachable: %w", err)
	}
	return pool, nil
}

// seedAdmin creates the first admin, holding the built-in Administrator role
// (put back first, should the roles have been emptied). Running it again once
// the email exists is a no-op, so it is safe in a deploy script.
func seedAdmin(ctx context.Context, pool *pgxpool.Pool, users *user.Service, cfg config, logger *slog.Logger) error {
	if err := role.EnsureBuiltins(ctx, pool); err != nil {
		return err
	}
	u, err := users.Bootstrap(ctx, cfg.SeedUserEmail, cfg.SeedUserName, cfg.SeedUserPassword, []uuid.UUID{role.AdminID})
	if errors.Is(err, user.ErrEmailTaken) {
		logger.Info("seed admin already exists", slog.String("email", cfg.SeedUserEmail))
		return nil
	}
	if err != nil {
		return err
	}
	logger.Info("seed admin created", slog.String("id", u.ID.String()), slog.String("email", u.Email))
	return nil
}
