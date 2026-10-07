// Package dbtest connects Postgres tests as the API's own role, ppe_app
// (migration 0026), so they exercise its grants as production does. Setup
// that empties tables keeps the owner's connection (API_TEST_DB_DSN).
package dbtest

import (
	"context"
	"net/url"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// appPassword is ppe_app's password in test databases only.
const appPassword = "ppe-app-test"

// AppPool lets ppe_app sign in with the test password (through owner, which
// may alter roles) and returns a pool connected as it to ownerDSN's database.
func AppPool(t *testing.T, owner *pgxpool.Pool, ownerDSN string) *pgxpool.Pool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := owner.Exec(ctx, `ALTER ROLE ppe_app WITH LOGIN PASSWORD '`+appPassword+`'`); err != nil {
		t.Fatalf("ppe_app: %v", err)
	}
	u, err := url.Parse(ownerDSN)
	if err != nil {
		t.Fatal(err)
	}
	u.User = url.UserPassword("ppe_app", appPassword)
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool
}
