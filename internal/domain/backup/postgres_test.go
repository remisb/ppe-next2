package backup

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/remisb/dbbackup"
	dbpg "github.com/remisb/dbbackup/postgres"
)

// TestPostgresRead seeds the tables through dbbackup's own Recorder, as the
// agent writes them, and reads them back.
func TestPostgresRead(t *testing.T) {
	dsn := os.Getenv("API_TEST_DB_DSN")
	if dsn == "" {
		t.Skip("API_TEST_DB_DSN not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := pool.Exec(ctx, `TRUNCATE dbbackup_runs, dbbackup_agents`); err != nil {
		t.Fatal(err)
	}
	repo := NewPostgresRepository(pool)

	empty, err := repo.Read(ctx, RunLimit)
	if err != nil {
		t.Fatal(err)
	}
	if empty.Agent != nil || empty.LastSuccess != nil || empty.Runs == nil || len(empty.Runs) != 0 || empty.Kept != (Kept{}) {
		t.Fatalf("empty = %+v", empty)
	}

	rec := dbpg.NewRecorder(pool)
	t0 := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	day := 24 * time.Hour
	for i, r := range []dbbackup.Run{
		{Status: dbbackup.StatusSucceeded, Key: "ppe2/1.dump.age", Size: 1000, Transforms: []string{"age"}},
		{Status: dbbackup.StatusSucceeded, Key: "ppe2/2.dump.age", Size: 2000, Transforms: []string{"age"}},
		{Status: dbbackup.StatusSucceeded, Key: "ppe2/3.dump.age", Size: 3000, Transforms: []string{"age"}},
		{Status: dbbackup.StatusFailed, Error: "connection refused"},
	} {
		r.ID = "00000000-0000-4000-8000-00000000000" + string(rune('1'+i))
		r.Agent, r.Engine, r.Database = "ppe-next2", "postgres", "ppe2"
		r.StartedAt = t0.Add(time.Duration(i) * day)
		r.FinishedAt = r.StartedAt.Add(3 * time.Second)
		if err := rec.Record(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	if err := rec.MarkPruned(ctx, []string{"ppe2/1.dump.age"}, t0.Add(20*day)); err != nil {
		t.Fatal(err)
	}
	for _, a := range []dbbackup.Agent{
		{Name: "old", Engine: "postgres", Database: "ppe2", LastSeenAt: t0},
		{Name: "ppe-next2", Engine: "postgres", Database: "ppe2", Schedule: "0 3 * * *", Timezone: "Europe/Vilnius",
			Interval: day, Transforms: []string{"age"}, LastSeenAt: t0.Add(4 * day), NextRunAt: t0.Add(5 * day)},
	} {
		if err := rec.Heartbeat(ctx, a); err != nil {
			t.Fatal(err)
		}
	}

	st, err := repo.Read(ctx, 3)
	if err != nil {
		t.Fatal(err)
	}
	if st.Agent == nil || st.Agent.Name != "ppe-next2" || st.Agent.IntervalSeconds != 86400 || !st.Agent.Encrypted ||
		st.Agent.NextRunAt == nil || !st.Agent.NextRunAt.Equal(t0.Add(5*day)) {
		t.Fatalf("agent = %+v", st.Agent)
	}
	if len(st.Runs) != 3 || st.Runs[0].Status != StatusFailed || st.Runs[2].Key != "ppe2/2.dump.age" {
		t.Fatalf("runs = %+v", st.Runs)
	}
	if st.LastSuccess == nil || st.LastSuccess.Key != "ppe2/3.dump.age" || !st.LastSuccess.Encrypted || st.LastSuccess.Pruned {
		t.Fatalf("last success = %+v", st.LastSuccess)
	}
	if st.Kept != (Kept{Count: 2, Bytes: 5000}) { // the pruned first backup is not kept
		t.Fatalf("kept = %+v", st.Kept)
	}
}
