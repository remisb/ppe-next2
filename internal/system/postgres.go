package system

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresStore keeps the error list in error_events and reads the
// database's own statistics (migration 0025).
type PostgresStore struct {
	pool *pgxpool.Pool
}

var _ Store = (*PostgresStore)(nil)

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

func (s *PostgresStore) RecordError(ctx context.Context, ev ErrorEvent, foldSince time.Time) error {
	var source *string
	if ev.Source != nil {
		v := string(*ev.Source)
		source = &v
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `
			UPDATE error_events SET count = count + 1, last_seen = $3, message = $4, stack = $5, source = $6,
				last_request_id = $7, last_user_id = $8, last_user_agent = $9
			WHERE id = (
				SELECT id FROM error_events WHERE fingerprint = $1 AND last_seen >= $2
				ORDER BY last_seen DESC LIMIT 1 FOR UPDATE)`,
			ev.Fingerprint, foldSince, ev.LastSeen, ev.Message, ev.Stack, source,
			ev.LastRequestID, ev.LastUserID, ev.LastUserAgent)
		if err != nil || tag.RowsAffected() > 0 {
			return err
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO error_events (id, fingerprint, kind, route, method, status, message, stack, source,
				first_seen, last_seen, count, last_request_id, last_user_id, last_user_agent)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			ev.ID, ev.Fingerprint, string(ev.Kind), ev.Route, ev.Method, ev.Status, ev.Message, ev.Stack, source,
			ev.FirstSeen, ev.LastSeen, ev.Count, ev.LastRequestID, ev.LastUserID, ev.LastUserAgent)
		return err
	})
}

func (s *PostgresStore) ListErrors(ctx context.Context, q ErrorQuery) ([]ErrorEvent, error) {
	var where []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if q.ID != nil {
		where = append(where, "e.id = "+arg(*q.ID))
	}
	if q.Kind != "" {
		where = append(where, "e.kind = "+arg(string(q.Kind)))
	}
	if q.After != nil {
		where = append(where, "(e.last_seen, e.id) < ("+arg(q.After.At)+", "+arg(q.After.ID)+")")
	}
	sql := `SELECT e.id, e.fingerprint, e.kind, e.route, e.method, e.status, e.message, e.stack, e.source,
			e.first_seen, e.last_seen, e.count, e.last_request_id, e.last_user_id, u.name, e.last_user_agent
		FROM error_events e LEFT JOIN users u ON u.id = e.last_user_id`
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}
	sql += " ORDER BY e.last_seen DESC, e.id DESC LIMIT " + arg(q.Limit)
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (ErrorEvent, error) {
		var e ErrorEvent
		var kind string
		var source *string
		err := row.Scan(&e.ID, &e.Fingerprint, &kind, &e.Route, &e.Method, &e.Status, &e.Message, &e.Stack, &source,
			&e.FirstSeen, &e.LastSeen, &e.Count, &e.LastRequestID, &e.LastUserID, &e.LastUserName, &e.LastUserAgent)
		e.Kind = Kind(kind)
		if source != nil {
			src := audit.Source(*source)
			e.Source = &src
		}
		e.FirstSeen, e.LastSeen = e.FirstSeen.UTC(), e.LastSeen.UTC()
		return e, err
	})
}

func (s *PostgresStore) NewErrorKinds(ctx context.Context, since time.Time) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `
		SELECT count(DISTINCT e.fingerprint) FROM error_events e
		WHERE e.first_seen >= $1
			AND NOT EXISTS (SELECT 1 FROM error_events o WHERE o.fingerprint = e.fingerprint AND o.first_seen < $1)`,
		since).Scan(&n)
	return n, err
}

func (s *PostgresStore) PurgeErrors(ctx context.Context, before time.Time) (int64, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM error_events WHERE last_seen < $1`, before)
	return tag.RowsAffected(), err
}

func (s *PostgresStore) Database(ctx context.Context, now time.Time) (Database, error) {
	d := Database{Connections: map[string]int{}, Tables: []Table{}}
	if err := s.pool.QueryRow(ctx, `
		SELECT current_setting('server_version'), pg_database_size(current_database()),
			current_setting('max_connections')::int,
			coalesce(extract(epoch FROM now() - (
				SELECT min(xact_start) FROM pg_stat_activity
				WHERE datname = current_database() AND xact_start IS NOT NULL AND pid <> pg_backend_pid()
					AND state <> 'idle')), 0)::float8`).
		Scan(&d.Version, &d.Bytes, &d.MaxConnections, &d.OldestTransactionSeconds); err != nil {
		return d, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT c.relname, pg_total_relation_size(c.oid), greatest(c.reltuples, 0)::bigint
		FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
			AND n.nspname NOT LIKE 'pg_toast%'
		ORDER BY 2 DESC, 1 LIMIT $1`, TableLimit)
	if err != nil {
		return d, err
	}
	if d.Tables, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (Table, error) {
		var t Table
		err := row.Scan(&t.Name, &t.Bytes, &t.Rows)
		return t, err
	}); err != nil {
		return d, err
	}

	rows, err = s.pool.Query(ctx, `
		SELECT coalesce(state, 'unknown'), count(*) FROM pg_stat_activity
		WHERE datname = current_database() GROUP BY 1`)
	if err != nil {
		return d, err
	}
	err = func() error {
		defer rows.Close()
		for rows.Next() {
			var state string
			var n int
			if err := rows.Scan(&state, &n); err != nil {
				return err
			}
			d.Connections[state] = n
		}
		return rows.Err()
	}()
	if err != nil {
		return d, err
	}

	var m Migration
	switch err := s.pool.QueryRow(ctx, `SELECT filename, applied_at FROM schema_migrations ORDER BY filename DESC LIMIT 1`).
		Scan(&m.File, &m.AppliedAt); {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return d, err
	default:
		m.AppliedAt = m.AppliedAt.UTC()
		d.LatestMigration = &m
	}

	// The newest sample at least GrowthSpan old, else the oldest there is.
	var sample Sample
	switch err := s.pool.QueryRow(ctx, `
		SELECT day, bytes FROM (
			(SELECT day, bytes, 0 AS pick FROM db_size_samples WHERE day <= $1::date ORDER BY day DESC LIMIT 1)
			UNION ALL
			(SELECT day, bytes, 1 FROM db_size_samples ORDER BY day LIMIT 1)
		) s ORDER BY pick LIMIT 1`, now.Add(-GrowthSpan)).Scan(&sample.Day, &sample.Bytes); {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return d, err
	default:
		sample.Day = time.Date(sample.Day.Year(), sample.Day.Month(), sample.Day.Day(), 0, 0, 0, 0, time.UTC)
		d.Earlier = &sample
	}
	return d, nil
}

func (s *PostgresStore) SampleSize(ctx context.Context, day time.Time) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO db_size_samples (day, bytes) VALUES ($1::date, pg_database_size(current_database()))
		ON CONFLICT (day) DO UPDATE SET bytes = EXCLUDED.bytes`, day.Format("2006-01-02"))
	return err
}
