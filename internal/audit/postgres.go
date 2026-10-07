package audit

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore reads audit_events (migrations 0002, 0023).
type PostgresStore struct {
	pool *pgxpool.Pool
}

var _ Store = (*PostgresStore)(nil)

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

// entityLabel and entityDeleted name each record type's row now. Deleted
// rows still exist (soft delete), so a deleted record keeps its name. An
// order is named by its record number, as order.FormatRecordNumber writes it.
const entityLabel = `CASE a.entity_type
		WHEN 'employee' THEN (SELECT x.first_name || ' ' || x.last_name FROM employees x WHERE x.id = a.entity_id)
		WHEN 'catalogue_item' THEN (SELECT x.name FROM catalogue_items x WHERE x.id = a.entity_id)
		WHEN 'item_set' THEN (SELECT x.name FROM item_sets x WHERE x.id = a.entity_id)
		WHEN 'order' THEN (SELECT 'WE-' || CASE WHEN x.record_seq < 1000000 THEN lpad(x.record_seq::text, 6, '0')
			ELSE x.record_seq::text END FROM orders x WHERE x.id = a.entity_id)
		WHEN 'user' THEN (SELECT x.name FROM users x WHERE x.id = a.entity_id)
		WHEN 'role' THEN (SELECT x.name FROM roles x WHERE x.id = a.entity_id)
	END`

const entityDeleted = `coalesce(CASE a.entity_type
		WHEN 'employee' THEN (SELECT x.deleted_at IS NOT NULL FROM employees x WHERE x.id = a.entity_id)
		WHEN 'catalogue_item' THEN (SELECT x.deleted_at IS NOT NULL FROM catalogue_items x WHERE x.id = a.entity_id)
		WHEN 'item_set' THEN (SELECT x.deleted_at IS NOT NULL FROM item_sets x WHERE x.id = a.entity_id)
		WHEN 'order' THEN (SELECT x.deleted_at IS NOT NULL FROM orders x WHERE x.id = a.entity_id)
		WHEN 'user' THEN (SELECT x.deleted_at IS NOT NULL FROM users x WHERE x.id = a.entity_id)
		WHEN 'role' THEN (SELECT x.deleted_at IS NOT NULL FROM roles x WHERE x.id = a.entity_id)
	END, false)`

func (s *PostgresStore) List(ctx context.Context, q Query) ([]Entry, error) {
	var where []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if q.ID != nil {
		where = append(where, "a.id = "+arg(*q.ID))
	}
	if len(q.EntityTypes) > 0 {
		where = append(where, "a.entity_type = ANY("+arg(q.EntityTypes)+")")
	}
	if q.EntityID != nil {
		where = append(where, "a.entity_id = "+arg(*q.EntityID))
	}
	if q.Event != "" {
		where = append(where, "a.event = "+arg(q.Event))
	}
	if q.ActorID != nil {
		where = append(where, "a.actor_user_id = "+arg(*q.ActorID))
	}
	if q.From != nil {
		where = append(where, "a.occurred_at >= "+arg(*q.From))
	}
	if q.To != nil {
		where = append(where, "a.occurred_at < "+arg(*q.To))
	}
	if q.After != nil {
		// Row comparison matches audit_events_time_idx (occurred_at DESC, id DESC).
		where = append(where, "(a.occurred_at, a.id) < ("+arg(q.After.At)+", "+arg(q.After.ID)+")")
	}
	sql := `SELECT a.id, a.occurred_at, a.event, a.entity_type, a.entity_id, ` + entityLabel + `, ` + entityDeleted + `,
			a.actor_user_id, u.name, a.source, a.request_id, a.session_id, s.user_agent, a.before, a.after
		FROM audit_events a
		LEFT JOIN users u ON u.id = a.actor_user_id
		LEFT JOIN user_sessions s ON s.id = a.session_id`
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}
	sql += " ORDER BY a.occurred_at DESC, a.id DESC LIMIT " + arg(q.Limit)
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Entry, error) {
		var e Entry
		var source, userAgent *string
		var before, after []byte
		if err := row.Scan(&e.ID, &e.OccurredAt, &e.Event, &e.EntityType, &e.EntityID, &e.EntityLabel, &e.EntityDeleted,
			&e.ActorID, &e.ActorName, &source, &e.RequestID, &e.SessionID, &userAgent, &before, &after); err != nil {
			return Entry{}, err
		}
		e.OccurredAt = e.OccurredAt.UTC()
		e.Area = AreaOf(e.EntityType)
		if source != nil {
			src := Source(*source)
			e.Source = &src
		}
		if userAgent != nil && *userAgent != "" {
			e.SessionUserAgent = userAgent
		}
		e.Before, e.After = rawOrNil(before), rawOrNil(after)
		return e, nil
	})
}

// rawOrNil keeps an absent side as JSON null.
func rawOrNil(b []byte) []byte {
	if len(b) == 0 {
		return nil
	}
	return b
}

func (s *PostgresStore) Insert(ctx context.Context, ev Event) error { return Insert(ctx, s.pool, ev) }

func (s *PostgresStore) EachRow(ctx context.Context, from, to time.Time, f func(Row) error) error {
	rows, err := s.pool.Query(ctx, `
		SELECT id, actor_user_id, event, entity_type, entity_id, occurred_at, before::text, after::text,
			request_id, session_id, source
		FROM audit_events WHERE occurred_at >= $1 AND occurred_at < $2
		ORDER BY occurred_at, id`, from, to)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var r Row
		if err := rows.Scan(&r.ID, &r.ActorID, &r.Event, &r.EntityType, &r.EntityID, &r.OccurredAt, &r.Before, &r.After,
			&r.RequestID, &r.SessionID, &r.Source); err != nil {
			return err
		}
		if err := f(r); err != nil {
			return err
		}
	}
	return rows.Err()
}

func (s *PostgresStore) FirstEventAt(ctx context.Context) (*time.Time, error) {
	var at *time.Time
	err := s.pool.QueryRow(ctx, `SELECT min(occurred_at) FROM audit_events`).Scan(&at)
	if at != nil {
		t := at.UTC()
		at = &t
	}
	return at, err
}

// utcDay reads a DATE, which pgx gives as midnight UTC, as that.
func utcDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func (s *PostgresStore) Seals(ctx context.Context) ([]Seal, error) {
	rows, err := s.pool.Query(ctx, `SELECT day, rows, hash, prev_hash, sealed_at FROM audit_seals ORDER BY day`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Seal, error) {
		var x Seal
		err := row.Scan(&x.Day, &x.Rows, &x.Hash, &x.PrevHash, &x.SealedAt)
		x.Day, x.SealedAt = utcDay(x.Day), x.SealedAt.UTC()
		return x, err
	})
}

func (s *PostgresStore) AddSeal(ctx context.Context, x Seal) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO audit_seals (day, rows, hash, prev_hash, sealed_at) VALUES ($1::date, $2, $3, $4, $5)`,
		x.Day.Format("2006-01-02"), x.Rows, x.Hash, x.PrevHash, x.SealedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrSealed
	}
	return err
}

func (s *PostgresStore) Stamps(ctx context.Context) ([]Stamp, error) {
	rows, err := s.pool.Query(ctx, `SELECT day, tsa, token, stamped_at, recorded_at FROM audit_seal_stamps ORDER BY day`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Stamp, error) {
		var x Stamp
		err := row.Scan(&x.Day, &x.TSA, &x.Token, &x.StampedAt, &x.RecordedAt)
		x.Day, x.StampedAt, x.RecordedAt = utcDay(x.Day), x.StampedAt.UTC(), x.RecordedAt.UTC()
		return x, err
	})
}

func (s *PostgresStore) AddStamp(ctx context.Context, x Stamp) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO audit_seal_stamps (day, tsa, token, stamped_at, recorded_at) VALUES ($1::date, $2, $3, $4, $5)`,
		x.Day.Format("2006-01-02"), x.TSA, x.Token, x.StampedAt, x.RecordedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return ErrStamped
	}
	return err
}

func (s *PostgresStore) Purges(ctx context.Context) ([]Purge, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, before_day, rows, purged_at FROM audit_purges ORDER BY purged_at, id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Purge, error) {
		var p Purge
		err := row.Scan(&p.ID, &p.BeforeDay, &p.Rows, &p.PurgedAt)
		p.BeforeDay, p.PurgedAt = utcDay(p.BeforeDay), p.PurgedAt.UTC()
		return p, err
	})
}

// purgeLock is the advisory lock the audit purge holds, so one instance purges.
const purgeLock = "ppe.purge_audit_events"

func (s *PostgresStore) Purge(ctx context.Context, p Purge, ev func(rows int64) (Event, error)) (Purge, error) {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var got bool
		if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtext($1))`, purgeLock).Scan(&got); err != nil || !got {
			return err
		}
		// The API's role cannot DELETE here: the function runs as the owner
		// and refuses anything younger than a year (migration 0026).
		if err := tx.QueryRow(ctx, `SELECT purge_audit_events($1)`, p.BeforeDay).Scan(&p.Rows); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO audit_purges (id, before_day, rows, purged_at) VALUES ($1, $2::date, $3, $4)`,
			p.ID, p.BeforeDay.Format("2006-01-02"), p.Rows, p.PurgedAt); err != nil {
			return err
		}
		e, err := ev(p.Rows)
		if err != nil {
			return err
		}
		return Insert(ctx, tx, e)
	})
	return p, err
}
