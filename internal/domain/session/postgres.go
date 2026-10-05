package session

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresRepository stores sessions in user_sessions (migration 0020).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const columns = `id, user_id, seed, generation, rotated_at, keep_signed_in, created_at,
	authenticated_at, last_used_at, idle_expires_at, expires_at, ended_at, end_reason, user_agent, ip`

func scan(row pgx.Row) (Session, error) {
	var s Session
	var reason *string
	err := row.Scan(&s.ID, &s.UserID, &s.Seed, &s.Generation, &s.RotatedAt, &s.KeepSignedIn, &s.CreatedAt,
		&s.AuthenticatedAt, &s.LastUsedAt, &s.IdleExpiresAt, &s.ExpiresAt, &s.EndedAt, &reason, &s.UserAgent, &s.IP)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, err
	}
	// pgx returns timestamptz in the local zone; the service works in UTC.
	for _, t := range []*time.Time{&s.RotatedAt, &s.CreatedAt, &s.AuthenticatedAt, &s.LastUsedAt, &s.IdleExpiresAt, &s.ExpiresAt} {
		*t = t.UTC()
	}
	if s.EndedAt != nil {
		t := s.EndedAt.UTC()
		s.EndedAt = &t
	}
	if reason != nil {
		s.EndReason = *reason
	}
	return s, nil
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (r *PostgresRepository) Create(ctx context.Context, s Session) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO user_sessions (`+columns+`)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		s.ID, s.UserID, s.Seed, s.Generation, s.RotatedAt, s.KeepSignedIn, s.CreatedAt,
		s.AuthenticatedAt, s.LastUsedAt, s.IdleExpiresAt, s.ExpiresAt, s.EndedAt, nullable(s.EndReason), s.UserAgent, s.IP)
	return translate(err)
}

func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Session, error) {
	var out Session
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM user_sessions WHERE id = $1 FOR UPDATE`, id))
		if err != nil {
			return err
		}
		next, err := m(cur)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE user_sessions SET generation = $2, rotated_at = $3, authenticated_at = $4,
				last_used_at = $5, idle_expires_at = $6, ended_at = $7, end_reason = $8, user_agent = $9, ip = $10
			WHERE id = $1`,
			id, next.Generation, next.RotatedAt, next.AuthenticatedAt, next.LastUsedAt, next.IdleExpiresAt,
			next.EndedAt, nullable(next.EndReason), next.UserAgent, next.IP); err != nil {
			return err
		}
		out = next
		return nil
	})
	return out, translate(err)
}

func (r *PostgresRepository) ListLive(ctx context.Context, userID uuid.UUID, now time.Time) ([]Session, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+columns+` FROM user_sessions
		WHERE user_id = $1 AND ended_at IS NULL AND expires_at > $2 AND idle_expires_at > $2
		ORDER BY last_used_at DESC, id`, userID, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Session, 0)
	for rows.Next() {
		s, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *PostgresRepository) EndAll(ctx context.Context, userID, keep uuid.UUID, at time.Time, reason string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE user_sessions SET ended_at = $3, end_reason = $4
		WHERE user_id = $1 AND id <> $2 AND ended_at IS NULL`, userID, keep, at, reason)
	return translate(err)
}

func (r *PostgresRepository) Prune(ctx context.Context, userID uuid.UUID, before time.Time) error {
	_, err := r.pool.Exec(ctx, `
		DELETE FROM user_sessions
		WHERE user_id = $1 AND (ended_at < $2 OR expires_at < $2 OR idle_expires_at < $2)`, userID, before)
	return translate(err)
}

// translate maps Postgres errors onto the domain's sentinels.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23503": // foreign_key_violation: user_id names no user
		return fieldError("user_id", "names no user")
	case "23514": // check_violation: the service validates first, so this is a bug
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
