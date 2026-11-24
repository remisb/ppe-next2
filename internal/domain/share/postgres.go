package share

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores shared links in shares (migration 0060).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository is the share repository over pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// columns are a link's (s) with its sharer's name; rows is a placeholder
// the caller fills (s.rows, or '[]' for lists).
const columns = `s.id, s.kind, s.name, s.columns, s.subject_ids::text[], %s, s.expires_at, s.created_at,
	s.created_by_user_id, u.name, s.revoked_at, s.revoked_by_user_id, s.erased_at, s.token_hash`

func selectFrom(rows string) string {
	return `SELECT ` + fmt.Sprintf(columns, rows) + ` FROM shares s JOIN users u ON u.id = s.created_by_user_id`
}

// scan reads a row of columns, times in UTC; no row is ErrNotFound.
func scan(row pgx.Row) (Share, error) {
	var (
		s    Share
		ids  []string
		rows []byte
	)
	err := row.Scan(&s.ID, &s.Kind, &s.Name, &s.Columns, &ids, &rows, &s.ExpiresAt, &s.CreatedAt,
		&s.CreatedByUserID, &s.CreatedByName, &s.RevokedAt, &s.RevokedByUserID, &s.ErasedAt, &s.TokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Share{}, ErrNotFound
	}
	if err != nil {
		return Share{}, err
	}
	s.SubjectIDs = make([]uuid.UUID, len(ids))
	for i, id := range ids {
		if s.SubjectIDs[i], err = uuid.Parse(id); err != nil {
			return Share{}, err
		}
	}
	s.RowCount = len(s.SubjectIDs)
	if err := json.Unmarshal(rows, &s.Rows); err != nil {
		return Share{}, err
	}
	if s.Rows == nil {
		s.Rows = []json.RawMessage{}
	}
	s.ExpiresAt, s.CreatedAt = s.ExpiresAt.UTC(), s.CreatedAt.UTC()
	for _, t := range []**time.Time{&s.RevokedAt, &s.ErasedAt} {
		if *t != nil {
			at := (*t).UTC()
			*t = &at
		}
	}
	return s, nil
}

// Create inserts s and ev and reads s back.
func (r *PostgresRepository) Create(ctx context.Context, s Share, ev audit.Event) (Share, error) {
	rows, err := json.Marshal(s.Rows)
	if err != nil {
		return Share{}, err
	}
	var out Share
	err = pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO shares (id, kind, name, token_hash, columns, subject_ids, rows, expires_at, created_at, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			s.ID, s.Kind, s.Name, s.TokenHash, s.Columns, s.SubjectIDs, rows, s.ExpiresAt, s.CreatedAt, s.CreatedByUserID); err != nil {
			return err
		}
		if err := audit.Insert(ctx, tx, ev); err != nil {
			return err
		}
		var err error
		out, err = scan(tx.QueryRow(ctx, selectFrom("s.rows")+` WHERE s.id = $1`, s.ID))
		return err
	})
	return out, translate(err)
}

// ByTokenHash reads the link with that hash, rows included.
func (r *PostgresRepository) ByTokenHash(ctx context.Context, hash string) (Share, error) {
	return scan(r.pool.QueryRow(ctx, selectFrom("s.rows")+` WHERE s.token_hash = $1`, hash))
}

// ListOpen reads actor's open links, newest first, without rows.
func (r *PostgresRepository) ListOpen(ctx context.Context, actor uuid.UUID, now time.Time) ([]Share, error) {
	rows, err := r.pool.Query(ctx, selectFrom(`'[]'::jsonb`)+`
		WHERE s.created_by_user_id = $1 AND s.revoked_at IS NULL AND s.expires_at > $2
		ORDER BY s.created_at DESC, s.id`, actor, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Share, 0)
	for rows.Next() {
		s, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Update locks the link, applies m and, when it returns events, writes the
// revocation and erasure with them; then reads the link back.
func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Share, error) {
	var out Share
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx, selectFrom("s.rows")+` WHERE s.id = $1 FOR UPDATE OF s`, id))
		if err != nil {
			return err
		}
		next, evs, err := m(cur)
		if err != nil {
			return err
		}
		if len(evs) == 0 {
			out = cur
			return nil
		}
		rows, err := json.Marshal(next.Rows)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE shares SET revoked_at = $2, revoked_by_user_id = $3, erased_at = $4, rows = $5 WHERE id = $1`,
			id, next.RevokedAt, next.RevokedByUserID, next.ErasedAt, rows); err != nil {
			return err
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out, err = scan(tx.QueryRow(ctx, selectFrom("s.rows")+` WHERE s.id = $1`, id))
		return err
	})
	return out, translate(err)
}

// EraseExpired empties every expired link's rows not yet erased.
func (r *PostgresRepository) EraseExpired(ctx context.Context, now time.Time) (int, error) {
	tag, err := r.pool.Exec(ctx, `UPDATE shares SET rows = '[]'::jsonb, erased_at = $1 WHERE erased_at IS NULL AND expires_at <= $1`, now)
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

// translate maps Postgres errors to sentinels: a foreign key is the actor
// (ErrActorNotFound), a CHECK ErrInvalid naming the constraint.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23503":
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
