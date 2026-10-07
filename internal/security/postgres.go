package security

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresStore keeps the security log in auth_events (migration 0024) and
// reads sessions, users and roles for the Security screen.
type PostgresStore struct {
	pool *pgxpool.Pool
}

var _ Store = (*PostgresStore)(nil)

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

func (s *PostgresStore) Insert(ctx context.Context, ev Event) error {
	return Insert(ctx, s.pool, ev)
}

func (s *PostgresStore) List(ctx context.Context, q Query) ([]Entry, error) {
	var where []string
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return fmt.Sprintf("$%d", len(args))
	}
	if q.Kind != "" {
		where = append(where, "e.kind = "+arg(string(q.Kind)))
	}
	if q.UserID != nil {
		where = append(where, "e.user_id = "+arg(*q.UserID))
	}
	if q.From != nil {
		where = append(where, "e.occurred_at >= "+arg(*q.From))
	}
	if q.To != nil {
		where = append(where, "e.occurred_at < "+arg(*q.To))
	}
	if q.After != nil {
		// Row comparison matches auth_events_time_idx (occurred_at DESC, id DESC).
		where = append(where, "(e.occurred_at, e.id) < ("+arg(q.After.At)+", "+arg(q.After.ID)+")")
	}
	sql := `SELECT e.id, e.occurred_at, e.kind, e.reason, e.user_id, u.name, u.email, e.email_hash,
			e.actor_user_id, a.name, e.session_id, e.ip, e.user_agent, e.request_id, e.source
		FROM auth_events e
		LEFT JOIN users u ON u.id = e.user_id
		LEFT JOIN users a ON a.id = e.actor_user_id`
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}
	sql += " ORDER BY e.occurred_at DESC, e.id DESC LIMIT " + arg(q.Limit)
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Entry, error) {
		var e Entry
		var kind string
		var source *string
		var hash []byte
		if err := row.Scan(&e.ID, &e.OccurredAt, &kind, &e.Reason, &e.UserID, &e.UserName, &e.UserEmail, &hash,
			&e.ActorID, &e.ActorName, &e.SessionID, &e.IP, &e.UserAgent, &e.RequestID, &source); err != nil {
			return Entry{}, err
		}
		e.OccurredAt = e.OccurredAt.UTC()
		e.Kind = Kind(kind)
		if source != nil {
			src := audit.Source(*source)
			e.Source = &src
		}
		if len(hash) >= 4 {
			ref := hex.EncodeToString(hash[:4])
			e.EmailRef = &ref
		}
		return e, nil
	})
}

func (s *PostgresStore) Failures(ctx context.Context, emailHash []byte, since time.Time, limit int) ([]time.Time, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT occurred_at FROM auth_events
		WHERE email_hash = $1 AND occurred_at > $2
			AND kind IN ('sign_in_failed', 'reauth_failed') AND reason = ANY($3)
			AND occurred_at > coalesce((
				SELECT max(occurred_at) FROM auth_events
				WHERE email_hash = $1 AND occurred_at > $2 AND kind IN ('sign_in', 'reauth')
			), '-infinity')
		ORDER BY occurred_at DESC
		LIMIT $4`, emailHash, since, failureReasons, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (time.Time, error) {
		var t time.Time
		err := row.Scan(&t)
		return t.UTC(), err
	})
}

func (s *PostgresStore) LiveSessions(ctx context.Context, now time.Time) ([]LiveSession, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT s.id, s.user_id, u.name, u.email, s.keep_signed_in, s.created_at, s.last_used_at,
			least(s.expires_at, s.idle_expires_at), s.user_agent, s.ip
		FROM user_sessions s
		JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
		WHERE s.ended_at IS NULL AND s.expires_at > $1 AND s.idle_expires_at > $1
		ORDER BY s.last_used_at DESC, s.id`, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (LiveSession, error) {
		var l LiveSession
		err := row.Scan(&l.ID, &l.UserID, &l.UserName, &l.UserEmail, &l.KeepSignedIn, &l.CreatedAt, &l.LastUsedAt,
			&l.ExpiresAt, &l.UserAgent, &l.IP)
		l.CreatedAt, l.LastUsedAt, l.ExpiresAt = l.CreatedAt.UTC(), l.LastUsedAt.UTC(), l.ExpiresAt.UTC()
		return l, err
	})
}

func (s *PostgresStore) Review(ctx context.Context, now time.Time) (ReviewData, error) {
	var out ReviewData
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.name, u.email, u.is_active, u.created_at, u.last_sign_in_at,
			(SELECT count(*) FROM user_sessions s
				WHERE s.user_id = u.id AND s.ended_at IS NULL AND s.expires_at > $1 AND s.idle_expires_at > $1),
			coalesce((SELECT array_agg(r.id ORDER BY r.key NULLS LAST, r.name) FROM user_roles ur
				JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL WHERE ur.user_id = u.id), '{}'),
			coalesce((SELECT array_agg(DISTINCT rp.permission ORDER BY rp.permission) FROM user_roles ur
				JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
				JOIN role_permissions rp ON rp.role_id = r.id WHERE ur.user_id = u.id), '{}')
		FROM users u
		WHERE u.deleted_at IS NULL
		ORDER BY lower(u.name), u.id`, now)
	if err != nil {
		return out, err
	}
	type userRow struct {
		ReviewUser
		roleIDs []uuid.UUID
	}
	users, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (userRow, error) {
		var u userRow
		err := row.Scan(&u.ID, &u.Name, &u.Email, &u.IsActive, &u.CreatedAt, &u.LastSignInAt, &u.LiveSessions,
			&u.roleIDs, &u.Permissions)
		u.CreatedAt = u.CreatedAt.UTC()
		if u.LastSignInAt != nil {
			t := u.LastSignInAt.UTC()
			u.LastSignInAt = &t
		}
		return u, err
	})
	if err != nil {
		return out, err
	}

	rows, err = s.pool.Query(ctx, `
		SELECT r.id, r.key, r.name, EXISTS (
			SELECT 1 FROM user_roles ur JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL
			WHERE ur.role_id = r.id)
		FROM roles r WHERE r.deleted_at IS NULL
		ORDER BY r.key NULLS LAST, lower(r.name)`)
	if err != nil {
		return out, err
	}
	roles := map[uuid.UUID]ReviewRole{}
	err = func() error {
		defer rows.Close()
		for rows.Next() {
			var r ReviewRole
			var held bool
			if err := rows.Scan(&r.ID, &r.Key, &r.Name, &held); err != nil {
				return err
			}
			roles[r.ID] = r
			if !held {
				out.UnusedRoles = append(out.UnusedRoles, r)
			}
		}
		return rows.Err()
	}()
	if err != nil {
		return out, err
	}
	for _, u := range users {
		u.Roles = make([]ReviewRole, 0, len(u.roleIDs))
		for _, id := range u.roleIDs {
			if r, ok := roles[id]; ok {
				u.Roles = append(u.Roles, r)
			}
		}
		out.Users = append(out.Users, u.ReviewUser)
	}

	var last LastReview
	err = s.pool.QueryRow(ctx, `
		SELECT a.id, a.occurred_at, a.actor_user_id, u.name
		FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
		WHERE a.event = $1
		ORDER BY a.occurred_at DESC, a.id DESC LIMIT 1`, EventAccessReviewCompleted).
		Scan(&last.EventID, &last.At, &last.ByID, &last.ByName)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return out, err
	default:
		last.At = last.At.UTC()
		out.LastReview = &last
	}
	return out, nil
}

func (s *PostgresStore) Summary(ctx context.Context, now, dayStart time.Time) (Summary, error) {
	var out Summary
	err := s.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM auth_events WHERE kind = 'refresh_reused' AND occurred_at > $2),
			(SELECT count(*) FROM auth_events WHERE kind IN ('sign_in_failed', 'reauth_failed') AND occurred_at > $3),
			coalesce((SELECT max(n) FROM (SELECT count(*) AS n FROM auth_events
				WHERE kind IN ('sign_in_failed', 'reauth_failed') AND occurred_at > $3 AND email_hash IS NOT NULL
				GROUP BY email_hash) per), 0),
			(SELECT count(*) FROM auth_events WHERE kind = 'sign_in' AND occurred_at >= $4),
			(SELECT count(*) FROM auth_events WHERE kind = 'sign_in_failed' AND occurred_at >= $4),
			(SELECT count(DISTINCT s.user_id) FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
				WHERE s.ended_at IS NULL AND s.expires_at > $1 AND s.idle_expires_at > $1),
			(SELECT count(*) FROM user_sessions s JOIN users u ON u.id = s.user_id AND u.deleted_at IS NULL
				WHERE s.ended_at IS NULL AND s.expires_at > $1 AND s.idle_expires_at > $1),
			(SELECT max(occurred_at) FROM audit_events WHERE event = $5)`,
		now, now.Add(-CopiedWithin), now.Add(-time.Hour), dayStart, EventAccessReviewCompleted).
		Scan(&out.CopiedSignIns, &out.FailedLastHour, &out.MostAtOneAccount, &out.SignInsToday, &out.FailedToday,
			&out.SignedIn, &out.Devices, &out.LastReview)
	if out.LastReview != nil {
		t := out.LastReview.UTC()
		out.LastReview = &t
	}
	return out, err
}

func (s *PostgresStore) Reviewed(ctx context.Context, ev audit.Event) error {
	return audit.Insert(ctx, s.pool, ev)
}

// purgeLock is the advisory lock the purge holds, so only one API instance
// purges at a time.
const purgeLock = "ppe.purge_auth_events"

func (s *PostgresStore) Purge(ctx context.Context, before time.Time) (int64, error) {
	var n int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var got bool
		if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtext($1))`, purgeLock).Scan(&got); err != nil || !got {
			return err
		}
		// The API's role cannot DELETE here: purge_auth_events (migration 0026)
		// runs as the owner and refuses rows younger than 30 days.
		return tx.QueryRow(ctx, `SELECT purge_auth_events($1)`, before).Scan(&n)
	})
	return n, err
}
