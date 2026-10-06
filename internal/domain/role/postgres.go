package role

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores roles in roles and role_permissions, and reads
// who holds them from user_roles (migration 0022).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// columns reads a role with its permissions and the live users holding it.
const columns = `r.id, r.key, r.name, r.description, r.created_at, r.updated_at, r.deleted_at,
	r.created_by_user_id, r.updated_by_user_id, r.deleted_by_user_id,
	coalesce((SELECT array_agg(p.permission) FROM role_permissions p WHERE p.role_id = r.id), '{}'),
	(SELECT count(*) FROM user_roles ur JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL WHERE ur.role_id = r.id)`

// builtinsFirst orders admin, manager, employee, then custom roles by name.
const builtinsFirst = `ORDER BY array_position(ARRAY['admin','manager','employee'], r.key) NULLS LAST, lower(r.name), r.id`

func scan(row pgx.Row) (Role, error) {
	var r Role
	var perms []string
	err := row.Scan(&r.ID, &r.Key, &r.Name, &r.Description, &r.CreatedAt, &r.UpdatedAt, &r.DeletedAt,
		&r.CreatedByUserID, &r.UpdatedByUserID, &r.DeletedByUserID, &perms, &r.UserCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return Role{}, ErrNotFound
	}
	if err != nil {
		return Role{}, err
	}
	r.CreatedAt, r.UpdatedAt = r.CreatedAt.UTC(), r.UpdatedAt.UTC()
	r.Permissions = Known(perms)
	r.Locked = r.Key != nil && *r.Key == KeyAdmin
	return r, nil
}

func scanAll(rows pgx.Rows) ([]Role, error) {
	defer rows.Close()
	out := make([]Role, 0)
	for rows.Next() {
		r, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (p *PostgresRepository) Create(ctx context.Context, r Role, ev *audit.Event) error {
	return translate(pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO roles (id, key, name, description, created_at, updated_at,
			created_by_user_id, updated_by_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			r.ID, r.Key, r.Name, r.Description, r.CreatedAt, r.UpdatedAt, r.CreatedByUserID, r.UpdatedByUserID); err != nil {
			return err
		}
		if err := writePermissions(ctx, tx, r.ID, r.Permissions); err != nil {
			return err
		}
		return insertEvent(ctx, tx, ev)
	}))
}

func (p *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Role, error) {
	return scan(p.pool.QueryRow(ctx, `SELECT `+columns+` FROM roles r WHERE r.id = $1 AND r.deleted_at IS NULL`, id))
}

func (p *PostgresRepository) List(ctx context.Context) ([]Role, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+columns+` FROM roles r WHERE r.deleted_at IS NULL `+builtinsFirst)
	if err != nil {
		return nil, err
	}
	return scanAll(rows)
}

func (p *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Role, error) {
	var out Role
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		// The lock comes first, so the user count read with it cannot change
		// before the write: assigning a role takes FOR SHARE on it.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM roles WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id); err != nil {
			return err
		}
		cur, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM roles r WHERE r.id = $1 AND r.deleted_at IS NULL`, id))
		if err != nil {
			return err
		}
		next, ev, err := m(cur)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE roles SET name = $2, description = $3, updated_at = $4,
			updated_by_user_id = $5, deleted_at = $6, deleted_by_user_id = $7 WHERE id = $1`,
			id, next.Name, next.Description, next.UpdatedAt, next.UpdatedByUserID, next.DeletedAt, next.DeletedByUserID); err != nil {
			return err
		}
		if next.DeletedAt == nil {
			if _, err := tx.Exec(ctx, `DELETE FROM role_permissions WHERE role_id = $1`, id); err != nil {
				return err
			}
			if err := writePermissions(ctx, tx, id, next.Permissions); err != nil {
				return err
			}
		}
		if err := insertEvent(ctx, tx, ev); err != nil {
			return err
		}
		out = next
		return nil
	})
	return out, translate(err)
}

func (p *PostgresRepository) Permissions(ctx context.Context, ids []uuid.UUID) ([]Permission, error) {
	var perms []string
	err := p.pool.QueryRow(ctx, `SELECT coalesce(array_agg(DISTINCT p.permission), '{}') FROM role_permissions p
		JOIN roles r ON r.id = p.role_id AND r.deleted_at IS NULL WHERE p.role_id = ANY($1)`, ids).Scan(&perms)
	if err != nil {
		return nil, err
	}
	return Known(perms), nil
}

func (p *PostgresRepository) OfUser(ctx context.Context, userID uuid.UUID) ([]Role, error) {
	rows, err := p.pool.Query(ctx, `SELECT `+columns+` FROM roles r
		JOIN user_roles ur ON ur.role_id = r.id AND ur.user_id = $1
		WHERE r.deleted_at IS NULL `+builtinsFirst, userID)
	if err != nil {
		return nil, err
	}
	return scanAll(rows)
}

func (p *PostgresRepository) Missing(ctx context.Context, ids []uuid.UUID) ([]uuid.UUID, error) {
	rows, err := p.pool.Query(ctx, `SELECT asked FROM unnest($1::uuid[]) AS asked
		WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.id = asked AND r.deleted_at IS NULL)`, ids)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// EnsureBuiltins creates the built-in roles with their installed permissions
// where they are missing, and leaves existing ones as they are. Migration
// 0022 creates them; this puts them back after a test or an e2e run empties
// the tables (TRUNCATE users CASCADE reaches roles through the actor keys),
// and -seed-admin calls it before adding the first administrator.
func EnsureBuiltins(ctx context.Context, pool *pgxpool.Pool) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		for _, b := range builtinRoles {
			tag, err := tx.Exec(ctx, `INSERT INTO roles (id, key, name, description, created_at, updated_at)
				VALUES ($1, $2, $3, $4, now(), now()) ON CONFLICT (id) DO NOTHING`, b.id, b.key, b.name, b.description)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 1 {
				if err := writePermissions(ctx, tx, b.id, builtins[b.key]); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func writePermissions(ctx context.Context, tx pgx.Tx, id uuid.UUID, perms []Permission) error {
	_, err := tx.Exec(ctx, `INSERT INTO role_permissions (role_id, permission) SELECT $1, unnest($2::text[])`, id, Strings(perms))
	return err
}

func insertEvent(ctx context.Context, tx pgx.Tx, ev *audit.Event) error {
	if ev == nil {
		return nil
	}
	return audit.Insert(ctx, tx, *ev)
}

// translate maps Postgres errors onto the domain's sentinels.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505": // unique_violation: roles_name_live_idx
		return ErrNameTaken
	case "23503": // foreign_key_violation: an actor column names no user
		return ErrActorNotFound
	case "23514": // check_violation: the service validates first, so this is a bug
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
