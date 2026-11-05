package main

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"testing"

	"github.com/remisb/ppe-next2/internal/db/testlock"
)

// web/e2e checks the same lock before it empties the database, and connects
// to the same default database when nothing is set.
func TestE2EUsesTheSameKeyAndDefaults(t *testing.T) {
	env, err := os.ReadFile("../../web/e2e/env.ts")
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`export const testLockKey = (0x[0-9a-fA-F]+)`).FindSubmatch(env)
	if m == nil {
		t.Fatal("web/e2e/env.ts has no testLockKey")
	}
	if k, _ := strconv.ParseInt(string(m[1]), 0, 64); k != testlock.Key {
		t.Errorf("env.ts' testLockKey is %s, testlock.Key %s", m[1], fmt.Sprintf("%#x", testlock.Key))
	}
	if !regexp.MustCompile(`\?\? '` + regexp.QuoteMeta(e2eDefaultDSN) + `'`).Match(env) {
		t.Errorf("env.ts' default dbDSN is not %s", e2eDefaultDSN)
	}
}

// Without a test database there is nothing to lock: the command just runs,
// and its status is the run's.
func TestRunsWithoutADatabase(t *testing.T) {
	t.Setenv("API_TEST_DB_DSN", "")
	if code := run([]string{"--", "sh", "-c", "exit 3"}); code != 3 {
		t.Errorf("status = %d", code)
	}
	if code := run([]string{}); code != 2 {
		t.Errorf("no command: %d", code)
	}
}
