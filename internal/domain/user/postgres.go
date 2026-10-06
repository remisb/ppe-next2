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

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores users in the users table (migration 0001) and the
// roles each holds in user_roles (migration 0022).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// userColumns reads a user with the live roles they hold, in id order.
const userColumns = `id, email, name, password_hash,
	coalesce((SELECT array_agg(ur.role_id ORDER BY ur.role_id::text) FROM user_roles ur
		JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL WHERE ur.user_id = users.id), '{}'),
	is_active, language,
	created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, deleted_by_user_id`

// guardLock serialises the writes that could remove the last administrator,
// so two at once cannot each see the other's administrator still there.
const guardLock = 0x0022_0001

func scanUser(row pgx.Row) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Email, &u.Name, &u.PasswordHash, &u.RoleIDs, &u.IsActive, &u.Language,
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
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO users (id, email, name, password_hash, is_active, language,
				created_at, updated_at, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			u.ID, u.Email, u.Name, u.PasswordHash, u.IsActive, u.Language,
			u.CreatedAt, u.UpdatedAt, u.CreatedByUserID, u.UpdatedByUserID); err != nil {
			return err
		}
		return writeRoles(ctx, tx, u.ID, u.RoleIDs)
	}))
}

// writeRoles replaces the roles user id holds. Each must be a live role,
// locked FOR SHARE so it cannot be deleted before this commits.
func writeRoles(ctx context.Context, tx pgx.Tx, id uuid.UUID, roleIDs []uuid.UUID) error {
	var live int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM (SELECT 1 FROM roles WHERE id = ANY($1) AND deleted_at IS NULL FOR SHARE) held`,
		roleIDs).Scan(&live); err != nil {
		return err
	}
	if live != len(roleIDs) {
		return fieldError("role_ids", "contains unknown role")
	}
	if _, err := tx.Exec(ctx, `DELETE FROM user_roles WHERE user_id = $1`, id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO user_roles (user_id, role_id) SELECT $1, unnest($2::uuid[])`, id, roleIDs)
	return err
}

// keepGuard fails with ErrLastAdministrator when no active, live user holds
// role guard any more. Call it after the write, under guardLock.
func keepGuard(ctx context.Context, tx pgx.Tx, guard uuid.UUID) error {
	if guard == uuid.Nil {
		return nil
	}
	var held bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id
		WHERE ur.role_id = $1 AND u.is_active AND u.deleted_at IS NULL)`, guard).Scan(&held); err != nil {
		return err
	}
	if !held {
		return ErrLastAdministrator
	}
	return nil
}

func lockGuard(ctx context.Context, tx pgx.Tx, guard uuid.UUID) error {
	if guard == uuid.Nil {
		return nil
	}
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, guardLock)
	return err
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

func (r *PostgresRepository) Update(ctx context.Context, u User, guard uuid.UUID, ev *audit.Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if err := lockGuard(ctx, tx, guard); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE users SET email = $2, name = $3, is_active = $4, updated_at = $5, updated_by_user_id = $6
			WHERE id = $1 AND deleted_at IS NULL`,
			u.ID, u.Email, u.Name, u.IsActive, u.UpdatedAt, u.UpdatedByUserID)
		if err := affectedOne(tag, err); err != nil {
			return err
		}
		if err := writeRoles(ctx, tx, u.ID, u.RoleIDs); err != nil {
			return err
		}
		if ev != nil {
			if err := audit.Insert(ctx, tx, *ev); err != nil {
				return err
			}
		}
		return keepGuard(ctx, tx, guard)
	}))
}

func (r *PostgresRepository) SetPasswordHash(ctx context.Context, id uuid.UUID, hash string, at time.Time, by uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET password_hash = $2, updated_at = $3, updated_by_user_id = $4
		WHERE id = $1 AND deleted_at IS NULL`, id, hash, at, by)
	return affectedOne(tag, err)
}

func (r *PostgresRepository) SetLanguage(ctx context.Context, id uuid.UUID, lang string, at time.Time, by uuid.UUID) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE users SET language = $2, updated_at = $3, updated_by_user_id = $4
		WHERE id = $1 AND deleted_at IS NULL`, id, lang, at, by)
	return affectedOne(tag, err)
}

func (r *PostgresRepository) Delete(ctx context.Context, id uuid.UUID, at time.Time, by uuid.UUID, guard uuid.UUID) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if err := lockGuard(ctx, tx, guard); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `
			UPDATE users SET deleted_at = $2, deleted_by_user_id = $3, updated_at = $2, updated_by_user_id = $3
			WHERE id = $1 AND deleted_at IS NULL`, id, at, by)
		if err := affectedOne(tag, err); err != nil {
			return err
		}
		return keepGuard(ctx, tx, guard)
	}))
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
	case "23503": // foreign_key_violation: an actor column names no user, or user_roles a role
		if pgErr.ConstraintName == "user_roles_role_id_fkey" {
			return fieldError("role_ids", "contains unknown role")
		}
		return ErrActorNotFound
	case "23514": // check_violation: the service validates first, so this is a bug
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
