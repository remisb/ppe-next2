package backup

import (
	"context"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/remisb/dbbackup"
	dbpg "github.com/remisb/dbbackup/postgres"
)

// PostgresRepository reads the agent's tables through dbbackup's own Reader,
// so the queries stay with the schema they belong to.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// Read runs in one read-only REPEATABLE READ transaction, so the totals agree
// with the runs even while the agent is recording one.
func (r *PostgresRepository) Read(ctx context.Context, limit int) (Status, error) {
	var st Status
	err := pgx.BeginTxFunc(ctx, r.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		s, err := dbpg.NewReader(tx).Status(ctx, limit)
		if err != nil {
			return err
		}
		st = fromLibrary(s)
		return nil
	})
	return st, err
}

func fromLibrary(s dbpg.Status) Status {
	st := Status{Kept: Kept{Count: s.Kept.Count, Bytes: s.Kept.Bytes}}
	// One agent backs up this database; should a second appear, show the one
	// that reported last.
	var latest *dbbackup.Agent
	for i := range s.Agents {
		if latest == nil || s.Agents[i].LastSeenAt.After(latest.LastSeenAt) {
			latest = &s.Agents[i]
		}
	}
	if latest != nil {
		st.Agent = &Agent{
			Name:            latest.Name,
			Schedule:        latest.Schedule,
			Timezone:        latest.Timezone,
			IntervalSeconds: int64(latest.Interval.Seconds()),
			Target:          latest.Target,
			Retention:       latest.Retention,
			Encrypted:       encrypted(latest.Transforms),
			Version:         latest.Version,
			LastSeenAt:      latest.LastSeenAt,
		}
		if !latest.NextRunAt.IsZero() {
			next := latest.NextRunAt
			st.Agent.NextRunAt = &next
		}
	}
	st.Runs = make([]Run, 0, len(s.Runs))
	for _, r := range s.Runs {
		st.Runs = append(st.Runs, fromRun(r))
	}
	if s.LastSuccess != nil {
		last := fromRun(*s.LastSuccess)
		st.LastSuccess = &last
	}
	return st
}

func fromRun(r dbbackup.Run) Run {
	return Run{
		ID:            r.ID,
		StartedAt:     r.StartedAt,
		FinishedAt:    r.FinishedAt,
		Status:        string(r.Status),
		Error:         r.Error,
		SizeBytes:     r.Size,
		ServerVersion: r.ServerVersion,
		ToolVersion:   r.ToolVersion,
		Target:        r.Target,
		Key:           r.Key,
		Encrypted:     encrypted(r.Transforms),
		Pruned:        !r.PrunedAt.IsZero(),
	}
}

// encrypted: the agent's only encrypting transform is age.
func encrypted(transforms []string) bool { return slices.Contains(transforms, "age") }
