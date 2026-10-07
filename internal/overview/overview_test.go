package overview

import (
	"os"
	"regexp"
	"slices"
	"testing"
	"time"
)

func keys(items []Item) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = string(it.Severity) + ":" + it.Key
	}
	return out
}

func TestAttention(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	recent := now.Add(-10 * 24 * time.Hour)
	old := now.Add(-100 * 24 * time.Hour)

	if got := Attention(Inputs{}, now); len(got) != 0 {
		t.Errorf("nothing to see = %v", got)
	}
	calm := Inputs{
		Backups:  &Backups{},
		Security: &Security{FailedLastHour: 20, MostAtOneAccount: 5, LastReview: &recent},
		Errors:   &Errors{LastHourRequests: 1000, LastHourErrors: 9},
		Database: &Database{Bytes: 120, EarlierBytes: 100, EarlierDay: now.Add(-30 * 24 * time.Hour)},
	}
	if got := Attention(calm, now); len(got) != 0 {
		t.Errorf("at every threshold, not over it: %v", keys(got))
	}

	busy := Inputs{
		Audit:    &Audit{MismatchDay: now.Add(-5 * 24 * time.Hour).Truncate(24 * time.Hour), StampsOverdue: 2},
		Backups:  &Backups{LastRunFailed: true},
		Security: &Security{CopiedSignIns: 1, FailedLastHour: 3, MostAtOneAccount: 6, LastReview: &old},
		Errors:   &Errors{LastHourRequests: 200, LastHourErrors: 3, NewKinds: 2},
		Database: &Database{Bytes: 130, EarlierBytes: 100, EarlierDay: now.Add(-30 * 24 * time.Hour), OwnerRights: true},
	}
	got := Attention(busy, now)
	want := []string{
		"critical:audit_seal_mismatch", "critical:copied_sign_in", "warning:last_backup_failed", "warning:failed_sign_ins",
		"warning:review_overdue", "warning:error_rate", "warning:new_errors", "warning:database_owner_rights", "warning:audit_not_timestamped",
		"info:database_growth",
	}
	if !slices.Equal(keys(got), want) {
		t.Fatalf("items = %v\nwant %v", keys(got), want)
	}
	if got[4].Days != 100 || got[5].Percent != 1.5 || got[5].Count != 3 || got[8].Count != 2 || got[9].Percent != 30 || got[9].Days != 30 || got[0].Since == nil {
		t.Errorf("figures = %+v", got)
	}

	// Not running outranks a failed run; never reviewed is overdue; a young
	// database or a quiet hour raises nothing.
	got = Attention(Inputs{
		Backups:  &Backups{AgentOffline: true, LastRunFailed: true},
		Security: &Security{},
		Errors:   &Errors{LastHourRequests: 10, LastHourErrors: 10},
		Audit:    &Audit{},
		Database: &Database{Bytes: 500, EarlierBytes: 100, EarlierDay: now.Add(-2 * 24 * time.Hour)},
	}, now)
	if !slices.Equal(keys(got), []string{"critical:backups_not_running", "warning:review_overdue"}) {
		t.Errorf("items = %v", keys(got))
	}
}

// The web's list of keys, which its words are typed against, is this one.
func TestWebClientListsTheKeys(t *testing.T) {
	src, err := os.ReadFile("../../web/packages/api-client/src/overview.ts")
	if err != nil {
		t.Fatal(err)
	}
	list := regexp.MustCompile(`(?s)ATTENTION_KEYS = \[(.*?)\] as const`).FindSubmatch(src)
	if list == nil {
		t.Fatal("no ATTENTION_KEYS in overview.ts")
	}
	var web []string
	for _, m := range regexp.MustCompile(`'([^']+)'`).FindAllSubmatch(list[1], -1) {
		web = append(web, string(m[1]))
	}
	if !slices.Equal(web, Keys()) {
		t.Errorf("overview.ts lists %v, Go %v", web, Keys())
	}
}
