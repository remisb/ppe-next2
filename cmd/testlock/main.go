// Command testlock runs a command while holding the shared test database's
// lock (internal/db/testlock), so only one test run at a time empties and
// uses it: `make test`, `make test-db` and web/e2e's `pnpm e2e` and
// `pnpm guide` run through it.
//
//	go run ./cmd/testlock [-e2e] [-wait 20m] -- <command> [args…]
//
// The database is API_TEST_DB_DSN's (with -e2e: E2E_DB_DSN's, else
// API_TEST_DB_DSN's, else web/e2e's default). With none set, or none
// reachable, nothing would be emptied, and the command just runs. Inside a
// run that holds the lock (PPE_TEST_LOCK names it), the command just runs.
// Otherwise it waits while another run holds the lock, saying which, then
// runs the command and exits with its status.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/remisb/ppe-next2/internal/db/testlock"
)

// e2eDefaultDSN is web/e2e/env.ts' dbDSN when neither E2E_DB_DSN nor
// API_TEST_DB_DSN is set (TestE2EDefaults keeps them equal).
const e2eDefaultDSN = "postgres://ppe2:ppe2@localhost:5442/ppe2_test?sslmode=disable"

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	fs := flag.NewFlagSet("testlock", flag.ContinueOnError)
	e2e := fs.Bool("e2e", false, "the e2e database: E2E_DB_DSN, else API_TEST_DB_DSN, else web/e2e's default")
	wait := fs.Duration("wait", 20*time.Minute, "how long to wait for another run to finish")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	command := fs.Args()
	if len(command) == 0 {
		fmt.Fprintln(os.Stderr, "testlock: no command (testlock [-e2e] [-wait 20m] -- <command> [args…])")
		return 2
	}
	dsn := os.Getenv("API_TEST_DB_DSN")
	if *e2e {
		dsn = firstSet(os.Getenv("E2E_DB_DSN"), dsn, e2eDefaultDSN)
	}
	if dsn == "" {
		return runCommand(command, "")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if token := os.Getenv(testlock.EnvToken); token != "" && heldBy(ctx, dsn, token) {
		return runCommand(command, token)
	}
	token := testlock.NewToken()
	what := describe(command)
	lock, err := testlock.Acquire(ctx, dsn, token, what, *wait, func(h testlock.Holder) {
		fmt.Fprintf(os.Stderr, "testlock: waiting for the test database, in use by %s\n", h)
	})
	if err != nil {
		var conn *pgconn.ConnectError
		if errors.As(err, &conn) {
			fmt.Fprintln(os.Stderr, "testlock: the test database is not reachable; running without its lock")
			return runCommand(command, "")
		}
		fmt.Fprintf(os.Stderr, "testlock: %v\n", err)
		return 1
	}
	defer lock.Release(context.Background())
	return runCommand(command, token)
}

// heldBy is whether the lock is held by the run token names (a command
// started inside it).
func heldBy(ctx context.Context, dsn, token string) bool {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return false
	}
	defer conn.Close(context.Background())
	h, ok, err := testlock.HolderOf(ctx, conn)
	return err == nil && ok && h.Token == token
}

// runCommand runs command with the lock's token in its environment, passing
// on an interrupt, and is its exit status.
func runCommand(command []string, token string) int {
	cmd := exec.Command(command[0], command[1:]...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.Env = os.Environ()
	if token != "" {
		cmd.Env = append(cmd.Env, testlock.EnvToken+"="+token)
	}
	signals := make(chan os.Signal, 2)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "testlock: %v\n", err)
		return 127
	}
	go func() {
		for s := range signals {
			_ = cmd.Process.Signal(s)
		}
	}()
	err := cmd.Wait()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode()
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "testlock: %v\n", err)
		return 1
	}
	return 0
}

// describe names the run for whoever waits for it, shortest first since
// Postgres keeps 63 bytes of it: its process, the folder it runs in (a
// worktree's name tells sessions apart) and the command.
func describe(command []string) string {
	dir, _ := os.Getwd()
	return fmt.Sprintf("pid %d, %s: %s", os.Getpid(), filepath.Base(dir), strings.Join(command, " "))
}

func firstSet(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
