package backup

import (
	"context"
	"testing"
	"time"
)

type fakeRepo struct{ st Status }

func (f fakeRepo) Read(context.Context, int) (Status, error) { return f.st, nil }

var now = time.Date(2026, 10, 5, 12, 0, 0, 0, time.UTC)

func status(t *testing.T, st Status) Status {
	t.Helper()
	got, err := NewService(fakeRepo{st}, WithClock(func() time.Time { return now })).Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return got
}

func run(started time.Time, status string) Run {
	return Run{ID: started.Format(time.RFC3339), StartedAt: started, FinishedAt: started.Add(1500 * time.Millisecond), Status: status}
}

func TestNothingYet(t *testing.T) {
	got := status(t, Status{})
	if !got.Stale || !got.AgentOffline || got.LastRunFailed || got.Runs == nil || !got.GeneratedAt.Equal(now) || got.Timezone != "UTC" {
		t.Fatalf("status = %+v", got)
	}
}

func TestStaleness(t *testing.T) {
	daily := &Agent{IntervalSeconds: 86400, LastSeenAt: now.Add(-time.Minute)}
	hourly := &Agent{IntervalSeconds: 3600, LastSeenAt: now.Add(-time.Minute)}
	for name, tc := range map[string]struct {
		agent *Agent
		age   time.Duration
		stale bool
	}{
		"daily, 25h old":      {daily, 25 * time.Hour, false},
		"daily, 26h01m old":   {daily, 26*time.Hour + time.Minute, true},
		"hourly, 2h30m old":   {hourly, 150 * time.Minute, false},
		"hourly, 3h01m old":   {hourly, 181 * time.Minute, true},
		"no agent, 25h old":   {nil, 25 * time.Hour, false}, // DefaultInterval is a day
		"no agent, 27h old":   {nil, 27 * time.Hour, true},
		"agent says nothing ": {&Agent{LastSeenAt: now}, 27 * time.Hour, true},
	} {
		t.Run(name, func(t *testing.T) {
			last := run(now.Add(-tc.age), StatusSucceeded)
			got := status(t, Status{Agent: tc.agent, LastSuccess: &last, Runs: []Run{last}})
			if got.Stale != tc.stale {
				t.Fatalf("stale = %v, want %v", got.Stale, tc.stale)
			}
			if got.LastSuccess.DurationMS != 1500 || got.Runs[0].DurationMS != 1500 {
				t.Fatalf("durations = %d, %d", got.LastSuccess.DurationMS, got.Runs[0].DurationMS)
			}
		})
	}
}

func TestAgentOfflineAndFailedRun(t *testing.T) {
	ok := run(now.Add(-2*time.Hour), StatusSucceeded)
	failed := run(now.Add(-time.Hour), StatusFailed)
	got := status(t, Status{
		Agent:       &Agent{IntervalSeconds: 86400, LastSeenAt: now.Add(-16 * time.Minute)},
		LastSuccess: &ok,
		Runs:        []Run{failed, ok},
	})
	if !got.AgentOffline || !got.LastRunFailed || got.Stale {
		t.Fatalf("status = %+v", got)
	}
	got = status(t, Status{Agent: &Agent{LastSeenAt: now.Add(-14 * time.Minute)}, LastSuccess: &ok, Runs: []Run{ok}})
	if got.AgentOffline || got.LastRunFailed {
		t.Fatalf("status = %+v", got)
	}
}
