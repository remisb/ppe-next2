package launcher

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
	"github.com/remisb/ppe-next2/internal/domain/role"
)

// PostgresRepository stores the registry in launcher_apps, launcher_pins and
// launcher_feedback (migration 0042).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const columns = `id, slug, kind, parent, app_group, icon, color, href, tier, stage, name_en, name_lt, name_ru, any_of,
	position, created_at, updated_at, updated_by_user_id`

const byPosition = ` ORDER BY position, slug`

func scan(row pgx.Row) (App, error) {
	var a App
	var anyOf []string
	err := row.Scan(&a.ID, &a.Slug, &a.Kind, &a.Parent, &a.Group, &a.Icon, &a.Color, &a.Href, &a.Tier, &a.Stage,
		&a.Names.EN, &a.Names.LT, &a.Names.RU, &anyOf, &a.Position, &a.CreatedAt, &a.UpdatedAt, &a.UpdatedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return App{}, ErrNotFound
	}
	if err != nil {
		return App{}, err
	}
	a.AnyOf = role.Known(anyOf)
	a.CreatedAt, a.UpdatedAt = a.CreatedAt.UTC(), a.UpdatedAt.UTC()
	return a, nil
}

func query(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, sql string, args ...any) ([]App, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]App, 0)
	for rows.Next() {
		a, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *PostgresRepository) List(ctx context.Context) ([]App, error) {
	return query(ctx, r.pool, `SELECT `+columns+` FROM launcher_apps`+byPosition)
}

func (r *PostgresRepository) Get(ctx context.Context, slug string) (App, error) {
	return scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM launcher_apps WHERE slug = $1`, slug))
}

func insert(ctx context.Context, tx pgx.Tx, a App, onConflict string) (pgconn.CommandTag, error) {
	return tx.Exec(ctx, `
		INSERT INTO launcher_apps (id, slug, kind, parent, app_group, icon, color, href, tier, stage, name_en, name_lt, name_ru,
			any_of, position, created_at, updated_at, updated_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`+onConflict,
		a.ID, a.Slug, a.Kind, a.Parent, a.Group, a.Icon, a.Color, a.Href, a.Tier, a.Stage, a.Names.EN, a.Names.LT, a.Names.RU,
		role.Strings(a.AnyOf), a.Position, a.CreatedAt, a.UpdatedAt, a.UpdatedByUserID)
}

func (r *PostgresRepository) Create(ctx context.Context, a App, ev audit.Event) (App, error) {
	var out App
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := insert(ctx, tx, a, ""); err != nil {
			return err
		}
		if err := audit.Insert(ctx, tx, ev); err != nil {
			return err
		}
		var err error
		out, err = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM launcher_apps WHERE id = $1`, a.ID))
		return err
	})
	return out, translate(err)
}

func (r *PostgresRepository) Update(ctx context.Context, slug string, m Mutation) (App, error) {
	var out App
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM launcher_apps WHERE slug = $1 FOR UPDATE`, slug))
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
		if _, err := tx.Exec(ctx, `
			UPDATE launcher_apps SET parent = $2, app_group = $3, icon = $4, color = $5, href = $6, tier = $7, stage = $8,
				name_en = $9, name_lt = $10, name_ru = $11, any_of = $12, updated_at = $13, updated_by_user_id = $14
			WHERE id = $1`,
			cur.ID, next.Parent, next.Group, next.Icon, next.Color, next.Href, next.Tier, next.Stage,
			next.Names.EN, next.Names.LT, next.Names.RU, role.Strings(next.AnyOf), next.UpdatedAt, next.UpdatedByUserID); err != nil {
			return err
		}
		out = next
		return audit.InsertAll(ctx, tx, evs)
	})
	return out, translate(err)
}

func (r *PostgresRepository) Reorder(ctx context.Context, m OrderMutation) ([]App, error) {
	var out []App
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := query(ctx, tx, `SELECT `+columns+` FROM launcher_apps`+byPosition+` FOR UPDATE`)
		if err != nil {
			return err
		}
		changed, evs, err := m(cur)
		if err != nil {
			return err
		}
		for _, a := range changed {
			if _, err := tx.Exec(ctx, `UPDATE launcher_apps SET position = $2, updated_at = $3, updated_by_user_id = $4 WHERE id = $1`,
				a.ID, a.Position, a.UpdatedAt, a.UpdatedByUserID); err != nil {
				return err
			}
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out, err = query(ctx, tx, `SELECT `+columns+` FROM launcher_apps`+byPosition)
		return err
	})
	return out, translate(err)
}

func (r *PostgresRepository) Pins(ctx context.Context, user uuid.UUID) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT a.slug FROM launcher_pins p JOIN launcher_apps a ON a.id = p.app_id
		WHERE p.user_id = $1 ORDER BY p.position`, user)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (r *PostgresRepository) SetPins(ctx context.Context, user uuid.UUID, apps []uuid.UUID) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM launcher_pins WHERE user_id = $1`, user); err != nil {
			return err
		}
		for i, id := range apps {
			if _, err := tx.Exec(ctx, `INSERT INTO launcher_pins (user_id, app_id, position) VALUES ($1, $2, $3)`, user, id, i+1); err != nil {
				return err
			}
		}
		return nil
	}))
}

func (r *PostgresRepository) AddFeedback(ctx context.Context, f Feedback) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO launcher_feedback (id, app_id, user_id, rating, text, device, language, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		f.ID, f.AppID, f.UserID, f.Rating, f.Text, f.Device, f.Language, f.CreatedAt)
	return translate(err)
}

func (r *PostgresRepository) Feedback(ctx context.Context, app uuid.UUID) ([]Feedback, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT f.id, f.app_id, f.user_id, u.name, f.rating, f.text, f.device, f.language, f.created_at
		FROM launcher_feedback f JOIN users u ON u.id = f.user_id
		WHERE f.app_id = $1 ORDER BY f.created_at DESC, f.id`, app)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Feedback, error) {
		var f Feedback
		err := row.Scan(&f.ID, &f.AppID, &f.UserID, &f.UserName, &f.Rating, &f.Text, &f.Device, &f.Language, &f.CreatedAt)
		f.CreatedAt = f.CreatedAt.UTC()
		return f, err
	})
	if out == nil {
		out = []Feedback{}
	}
	return out, err
}

// EnsureDefaults inserts the default tiles that are missing, by slug, after
// the tiles already there; it never changes one that exists. The API runs it
// at start-up, and tests after emptying the database.
func EnsureDefaults(ctx context.Context, pool *pgxpool.Pool) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		// One start-up at a time, so two never number the same new tiles.
		if _, err := tx.Exec(ctx, `LOCK TABLE launcher_apps IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return err
		}
		var last int
		if err := tx.QueryRow(ctx, `SELECT coalesce(max(position), 0) FROM launcher_apps`).Scan(&last); err != nil {
			return err
		}
		now := time.Now().UTC().Truncate(time.Microsecond)
		for _, d := range Defaults {
			a := d
			a.ID, a.CreatedAt, a.UpdatedAt, a.Position = uuid.New(), now, now, last+positionStep
			tag, err := insert(ctx, tx, a, ` ON CONFLICT (slug) DO NOTHING`)
			if err != nil {
				return fmt.Errorf("default tile %s: %w", d.Slug, err)
			}
			if tag.RowsAffected() == 1 {
				last += positionStep
			}
		}
		return nil
	})
}

func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505":
		return ErrSlugTaken
	case "23503":
		if pgErr.ConstraintName == "launcher_apps_updated_by_user_id_fkey" || pgErr.ConstraintName == "launcher_feedback_user_id_fkey" ||
			pgErr.ConstraintName == "launcher_pins_user_id_fkey" {
			return ErrActorNotFound
		}
		return ErrNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
