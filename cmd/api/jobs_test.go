package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/remisb/ppe-next2/internal/audit"
)

type stubVerifier struct{ v audit.Verification }

func (s stubVerifier) Verify(context.Context) (audit.Verification, error) { return s.v, nil }

func TestVerifyAuditPrintsAndFailsOnMismatch(t *testing.T) {
	var out strings.Builder
	if err := verifyAudit(context.Background(), stubVerifier{audit.Verification{OK: true, Days: 3, Rows: 7}}, &out); err != nil {
		t.Fatalf("matching seals: %v", err)
	}
	var got audit.Verification
	if err := json.Unmarshal([]byte(out.String()), &got); err != nil || !got.OK || got.Days != 3 || got.Rows != 7 {
		t.Errorf("printed %q (%v), want the verification as JSON", out.String(), err)
	}

	day := time.Date(2026, 10, 5, 0, 0, 0, 0, time.UTC)
	out.Reset()
	err := verifyAudit(context.Background(), stubVerifier{audit.Verification{Mismatch: &audit.Mismatch{Day: day, Problem: "hash"}}}, &out)
	if err == nil || !strings.Contains(err.Error(), "2026-10-05") || !strings.Contains(err.Error(), "hash") {
		t.Errorf("mismatch: err = %v, want the day and the problem", err)
	}
	if !strings.Contains(out.String(), `"problem": "hash"`) {
		t.Errorf("mismatch not printed: %q", out.String())
	}
}
