package audit

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
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
