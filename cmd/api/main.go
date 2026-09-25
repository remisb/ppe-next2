// Command api serves the PPE-next2 HTTP API.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/remisb/muxstack/middleware"

	"github.com/remisb/ppe-next2/internal/domain/catalogue"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/itemset"
	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/user"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
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
	svc := newServices(
		loc, cfg.ConfirmTTL,
		user.NewService(user.NewPostgresRepository(pool)),
		employee.NewPostgresRepository(pool),
		catalogue.NewPostgresRepository(pool),
		itemset.NewPostgresRepository(pool),
		order.NewPostgresRepository(pool),
	)

	if cfg.SeedAdmin {
		return seedAdmin(ctx, svc.users, cfg, logger)
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
	logger.Info("listening", slog.String("addr", ln.Addr().String()))
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	logger.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// services are the domain services the API exposes.
type services struct {
	users     *user.Service
	employees *employee.Service
	catalogue *catalogue.Service
	itemSets  *itemset.Service
	orders    *order.Service
}

// newServices builds every service from its repository and wires the
// cross-domain adapters in checkers.go.
func newServices(loc *time.Location, confirmTTL time.Duration, users *user.Service, employees employee.Repository, items catalogue.Repository, sets itemset.Repository, orders order.Repository) services {
	s := services{
		users:     users,
		employees: employee.NewService(employees),
		catalogue: catalogue.NewService(items),
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
	// Settings the UI needs to show dates in the zone History filters use.
	rt.authenticated("GET /api/v1/settings", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"timezone": cfg.OrgTimezone, "currency": "EUR"})
	})
	registerAuthRoutes(rt, svc.users, tok, cfg.LoginRateLimit, cfg.LoginRateInterval)
	registerUserRoutes(rt, svc.users)
	registerEmployeeRoutes(rt, svc.employees)
	registerCatalogueRoutes(rt, svc.catalogue)
	registerItemSetRoutes(rt, svc.itemSets)
	registerOrderRoutes(rt, svc.orders)
	registerConfirmationRoutes(rt, svc.orders, cfg.PublicBaseURL)
	return rt
}

// routes wraps the router in the global middleware.
func routes(cfg config, svc services, tok *tokens, logger *slog.Logger) http.Handler {
	mux := buildRouter(cfg, svc, tok).mux

	global := []middleware.Middleware{
		middleware.Recoverer(logger),
		// Before Logger and the rate limiters, which read the client it resolves.
		middleware.ClientIP(middleware.ClientIPConfig{TrustedProxies: cfg.TrustedProxies}),
		middleware.Logger(logger),
	}
	if len(cfg.AllowedOrigins) > 0 {
		cors := middleware.DefaultCORSConfig()
		cors.AllowedOrigins = cfg.AllowedOrigins
		global = append(global, middleware.CORS(cors))
	}
	global = append(global, middleware.Timeout(cfg.RequestTimeout))
	return middleware.Chain(mux, global...)
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

// seedAdmin creates the first admin. Running it again once the email exists is
// a no-op, so it is safe in a deploy script.
func seedAdmin(ctx context.Context, users *user.Service, cfg config, logger *slog.Logger) error {
	u, err := users.Bootstrap(ctx, cfg.SeedUserEmail, cfg.SeedUserName, cfg.SeedUserPassword)
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
