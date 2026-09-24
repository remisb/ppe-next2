package user

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

// PostgresRepository stores users in the users table (migration 0001).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const userColumns = `id, email, name, password_hash, roles, is_active,
	created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, deleted_by_user_id`

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.Roles, &u.IsActive,
		&u.CreatedAt, &u.UpdatedAt, &u.DeletedAt, &u.CreatedByUserID, &u.UpdatedByUserID, &u.DeletedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	// pgx returns timestamptz in the local zone; the service works in UTC.
	u.CreatedAt, u.UpdatedAt = u.CreatedAt.UTC(), u.UpdatedAt.UTC()
	if u.DeletedAt != nil {
		t := u.DeletedAt.UTC()
		u.DeletedAt = &t
	}
	return u, nil
}

func (r *PostgresRepository) Create(ctx context.Context, u User) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO users (id, email, name, password_hash, roles, is_active,
			created_at, updated_at, created_by_user_id, updated_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		u.ID, u.Email, u.Name, u.PasswordHash, u.Roles, u.IsActive,
		u.CreatedAt, u.UpdatedAt, u.CreatedByUserID, u.UpdatedByUserID)
	return translate(err)
}

func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (User, error) {
	return scanUser(r.pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE id = $1 AND deleted_at IS NULL`, id))
}

func (r *PostgresRepository) ByEmail(ctx context.Context, email string) (User, error) {
	// lower(email) = lower($1) matches users_email_live_idx.
	return scanUser(r.pool.QueryRow(ctx,
		`SELECT `+userColumns+` FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`, email))
}

func (r *PostgresRepository) List(ctx context.Context) ([]User, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+userColumns+` FROM users WHERE deleted_at IS NULL ORDER BY lower(name), id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]User, 0)
	for rows.Next() {
		u, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *PostgresRepository) Update(ctx context.Context, u User) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET email = $2, name = $3, roles = $4, is_active = $5,
			updated_at = $6, updated_by_user_id = $7
		WHERE id = $1 AND deleted_at IS NULL`,
		u.ID, u.Email, u.Name, u.Roles, u.IsActive, u.UpdatedAt, u.UpdatedByUserID)
	return affectedOne(tag, err)
}

func (r *PostgresRepository) SetPasswordHash(ctx context.Context, id uuid.UUID, hash string, at time.Time, by uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET password_hash = $2, updated_at = $3, updated_by_user_id = $4
		WHERE id = $1 AND deleted_at IS NULL`, id, hash, at, by)
	return affectedOne(tag, err)
}

func (r *PostgresRepository) Delete(ctx context.Context, id uuid.UUID, at time.Time, by uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET deleted_at = $2, deleted_by_user_id = $3, updated_at = $2, updated_by_user_id = $3
		WHERE id = $1 AND deleted_at IS NULL`, id, at, by)
	return affectedOne(tag, err)
}

func affectedOne(tag pgconn.CommandTag, err error) error {
	if err != nil {
		return translate(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// translate maps Postgres errors onto the domain's sentinels.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505": // unique_violation: users_email_live_idx
		return ErrEmailTaken
	case "23503": // foreign_key_violation: an actor column names no user
		return ErrActorNotFound
	case "23514": // check_violation: the service validates first, so this is a bug
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
