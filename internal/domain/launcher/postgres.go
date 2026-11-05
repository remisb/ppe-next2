package launcher

import (
	"context"
	"errors"
	"fmt"
	"slices"
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
	position, stable_follows_deploys, created_at, updated_at, updated_by_user_id`

const byPosition = ` ORDER BY position, slug`

func scan(row pgx.Row) (App, error) {
	var a App
	var anyOf []string
	err := row.Scan(&a.ID, &a.Slug, &a.Kind, &a.Parent, &a.Group, &a.Icon, &a.Color, &a.Href, &a.Tier, &a.Stage,
		&a.Names.EN, &a.Names.LT, &a.Names.RU, &anyOf, &a.Position, &a.StableFollowsDeploys, &a.CreatedAt, &a.UpdatedAt, &a.UpdatedByUserID)
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
		// One new tile at a time, so two registered at once never share a place.
		if _, err := tx.Exec(ctx, `LOCK TABLE launcher_apps IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return err
		}
		var last int
		if err := tx.QueryRow(ctx, `SELECT coalesce(max(position), 0) FROM launcher_apps`).Scan(&last); err != nil {
			return err
		}
		a.Position = max(a.Position, last+positionStep)
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
				name_en = $9, name_lt = $10, name_ru = $11, any_of = $12, updated_at = $13, updated_by_user_id = $14,
				stable_follows_deploys = $15
			WHERE id = $1`,
			cur.ID, next.Parent, next.Group, next.Icon, next.Color, next.Href, next.Tier, next.Stage,
			next.Names.EN, next.Names.LT, next.Names.RU, role.Strings(next.AnyOf), next.UpdatedAt, next.UpdatedByUserID,
			next.StableFollowsDeploys); err != nil {
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

// pinsLock is the advisory lock's first key for replacing a user's pins (the
// second is the user's): two replaces at once, as from two tabs or a page's
// effect run twice, take turns instead of one failing on the other's rows.
const pinsLock = 0x70696e73 // "pins"

func (r *PostgresRepository) SetPins(ctx context.Context, user uuid.UUID, apps []uuid.UUID) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1, hashtext($2::text))`, pinsLock, user); err != nil {
			return err
		}
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

const versionColumns = `id, app_id, version, profile, capabilities, commit, published_at, published_by_user_id`

func scanVersion(row pgx.CollectableRow) (Version, error) {
	var v Version
	err := row.Scan(&v.ID, &v.AppID, &v.Version, &v.Profile, &v.Capabilities, &v.Commit, &v.PublishedAt, &v.PublishedByUserID)
	v.PublishedAt = v.PublishedAt.UTC()
	return v, err
}

func (r *PostgresRepository) Versions(ctx context.Context, app uuid.UUID) ([]Version, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+versionColumns+` FROM launcher_versions WHERE app_id = $1 ORDER BY published_at DESC, version DESC`, app)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, scanVersion)
	if out == nil {
		out = []Version{}
	}
	return out, err
}

func (r *PostgresRepository) AddVersion(ctx context.Context, v Version, ev audit.Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO launcher_versions (`+versionColumns+`) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			v.ID, v.AppID, v.Version, v.Profile, v.Capabilities, v.Commit, v.PublishedAt, v.PublishedByUserID); err != nil {
			return err
		}
		return audit.Insert(ctx, tx, ev)
	}))
}

func (r *PostgresRepository) PruneVersions(ctx context.Context, app uuid.UUID, m PruneMutation) ([]Version, error) {
	var removed []Version
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		// The app's row first, as PutChannel locks it: no channel moves onto a version while it goes.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM launcher_apps WHERE id = $1 FOR UPDATE`, app); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT `+versionColumns+` FROM launcher_versions WHERE app_id = $1 ORDER BY published_at DESC, version DESC`, app)
		if err != nil {
			return err
		}
		versions, err := pgx.CollectRows(rows, scanVersion)
		if err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `SELECT `+channelColumns+` FROM launcher_channels c JOIN launcher_versions v ON v.id = c.version_id WHERE c.app_id = $1`+channelOrder, app)
		if err != nil {
			return err
		}
		channels, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Channel, error) { return scanChannel(row) })
		if err != nil {
			return err
		}
		remove, ev, err := m(versions, channels)
		if err != nil || len(remove) == 0 {
			return err
		}
		ids := make([]uuid.UUID, len(remove))
		for i, v := range remove {
			ids[i] = v.ID
		}
		if _, err := tx.Exec(ctx, `DELETE FROM launcher_versions WHERE app_id = $1 AND id = ANY($2)`, app, ids); err != nil {
			return err
		}
		removed = remove
		if ev == nil {
			return nil
		}
		return audit.Insert(ctx, tx, *ev)
	})
	return removed, translate(err)
}

// channelColumns are a channel's (c), with its version's name and date (v).
const channelColumns = `c.id, c.app_id, c.name, c.label_en, c.label_lt, c.label_ru, c.version_id, v.version, v.published_at, c.any_of,
	c.updated_at, c.updated_by_user_id`

// channelOrder: Stable, Beta, Preview, then variants by name.
const channelOrder = ` ORDER BY c.app_id, array_position(ARRAY['stable','beta','preview'], c.name) NULLS LAST, c.name`

func scanChannel(row pgx.Row) (Channel, error) {
	var c Channel
	var anyOf []string
	err := row.Scan(&c.ID, &c.AppID, &c.Name, &c.Label.EN, &c.Label.LT, &c.Label.RU, &c.VersionID, &c.Version, &c.PublishedAt, &anyOf,
		&c.UpdatedAt, &c.UpdatedByUserID)
	c.AnyOf = role.Known(anyOf)
	c.PublishedAt, c.UpdatedAt = c.PublishedAt.UTC(), c.UpdatedAt.UTC()
	return c, err
}

func (r *PostgresRepository) Channels(ctx context.Context) ([]Channel, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+channelColumns+` FROM launcher_channels c JOIN launcher_versions v ON v.id = c.version_id`+channelOrder)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Channel, error) { return scanChannel(row) })
	if out == nil {
		out = []Channel{}
	}
	return out, err
}

func (r *PostgresRepository) PutChannel(ctx context.Context, app uuid.UUID, name string, m ChannelMutation) (Channel, error) {
	var out Channel
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		// The app's row, so two first channels of one name never race.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM launcher_apps WHERE id = $1 FOR UPDATE`, app); err != nil {
			return err
		}
		var cur *Channel
		c, err := scanChannel(tx.QueryRow(ctx, `SELECT `+channelColumns+` FROM launcher_channels c JOIN launcher_versions v ON v.id = c.version_id
			WHERE c.app_id = $1 AND c.name = $2 FOR UPDATE OF c`, app, name))
		switch {
		case err == nil:
			cur = &c
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		next, evs, err := m(cur)
		if err != nil {
			return err
		}
		out = next
		if len(evs) == 0 {
			return nil
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO launcher_channels (id, app_id, name, label_en, label_lt, label_ru, version_id, any_of, updated_at, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (app_id, name) DO UPDATE SET label_en = $4, label_lt = $5, label_ru = $6, version_id = $7, any_of = $8,
				updated_at = $9, updated_by_user_id = $10`,
			next.ID, app, name, next.Label.EN, next.Label.LT, next.Label.RU, next.VersionID, role.Strings(next.AnyOf), next.UpdatedAt, next.UpdatedByUserID); err != nil {
			return err
		}
		return audit.InsertAll(ctx, tx, evs)
	})
	return out, translate(err)
}

func (r *PostgresRepository) Choices(ctx context.Context, user uuid.UUID) (map[uuid.UUID]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT app_id, channel FROM launcher_channel_choices WHERE user_id = $1`, user)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]string{}
	for rows.Next() {
		var app uuid.UUID
		var channel string
		if err := rows.Scan(&app, &channel); err != nil {
			return nil, err
		}
		out[app] = channel
	}
	return out, rows.Err()
}

func (r *PostgresRepository) SetChoice(ctx context.Context, user, app uuid.UUID, channel string) error {
	if channel == "" {
		_, err := r.pool.Exec(ctx, `DELETE FROM launcher_channel_choices WHERE user_id = $1 AND app_id = $2`, user, app)
		return translate(err)
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO launcher_channel_choices (user_id, app_id, channel) VALUES ($1, $2, $3)
		ON CONFLICT (user_id, app_id) DO UPDATE SET channel = $3`, user, app, channel)
	return translate(err)
}

func (r *PostgresRepository) AddFeedback(ctx context.Context, f Feedback) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO launcher_feedback (id, app_id, user_id, rating, text, device, language, version, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		f.ID, f.AppID, f.UserID, f.Rating, f.Text, f.Device, f.Language, f.Version, f.CreatedAt)
	return translate(err)
}

func (r *PostgresRepository) Feedback(ctx context.Context, app uuid.UUID) ([]Feedback, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT f.id, f.app_id, f.user_id, u.name, f.rating, f.text, f.device, f.language, f.version, f.created_at
		FROM launcher_feedback f JOIN users u ON u.id = f.user_id
		WHERE f.app_id = $1 ORDER BY f.created_at DESC, f.id`, app)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Feedback, error) {
		var f Feedback
		err := row.Scan(&f.ID, &f.AppID, &f.UserID, &f.UserName, &f.Rating, &f.Text, &f.Device, &f.Language, &f.Version, &f.CreatedAt)
		f.CreatedAt = f.CreatedAt.UTC()
		return f, err
	})
	if out == nil {
		out = []Feedback{}
	}
	return out, err
}

// EnsureDefaults brings the registry in line with Defaults at start-up (and
// after a test empties it). Code owns a default tile until an administrator
// changes it: a missing default is inserted, last; one no administrator has
// touched (updated_by_user_id is NULL) takes the code's fields if they
// differ, recorded as app.changed and app.audience_changed by no one; one an
// administrator edited, moved or switched is left as it is. Its place in the
// order is never changed here.
func EnsureDefaults(ctx context.Context, pool *pgxpool.Pool) error {
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		// One start-up at a time, so two never number the same new tiles.
		if _, err := tx.Exec(ctx, `LOCK TABLE launcher_apps IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return err
		}
		have, err := query(ctx, tx, `SELECT `+columns+` FROM launcher_apps`+byPosition)
		if err != nil {
			return err
		}
		last := 0
		for _, a := range have {
			last = max(last, a.Position)
		}
		now := time.Now().UTC().Truncate(time.Microsecond)
		for _, d := range Defaults {
			at := slices.IndexFunc(have, func(a App) bool { return a.Slug == d.Slug })
			if at < 0 {
				a := d
				last += positionStep
				a.ID, a.CreatedAt, a.UpdatedAt, a.Position = uuid.New(), now, now, last
				if _, err := insert(ctx, tx, a, ""); err != nil {
					return fmt.Errorf("default tile %s: %w", d.Slug, err)
				}
				continue
			}
			cur := have[at]
			if cur.UpdatedByUserID != nil || cur.Kind != d.Kind {
				continue
			}
			next := cur
			next.Parent, next.Group, next.Icon, next.Color, next.Href = d.Parent, d.Group, d.Icon, d.Color, d.Href
			next.Tier, next.Stage, next.Names, next.AnyOf = d.Tier, d.Stage, d.Names, role.Known(role.Strings(d.AnyOf))
			var evs []audit.Event
			if before, after := shown(cur), shown(next); before != after {
				ev, err := audit.New(uuid.New(), nil, EventChanged, auditEntity, cur.ID, now, before, after)
				if err != nil {
					return err
				}
				evs = append(evs, ev)
			}
			if !slices.Equal(cur.AnyOf, next.AnyOf) {
				ev, err := audit.New(uuid.New(), nil, EventAudienceChanged, auditEntity, cur.ID, now,
					audience{role.Strings(cur.AnyOf)}, audience{role.Strings(next.AnyOf)})
				if err != nil {
					return err
				}
				evs = append(evs, ev)
			}
			if len(evs) == 0 {
				continue
			}
			// updated_by stays NULL: the code still owns it.
			if _, err := tx.Exec(ctx, `
				UPDATE launcher_apps SET parent = $2, app_group = $3, icon = $4, color = $5, href = $6, tier = $7, stage = $8,
					name_en = $9, name_lt = $10, name_ru = $11, any_of = $12, updated_at = $13
				WHERE id = $1`,
				cur.ID, next.Parent, next.Group, next.Icon, next.Color, next.Href, next.Tier, next.Stage,
				next.Names.EN, next.Names.LT, next.Names.RU, role.Strings(next.AnyOf), now); err != nil {
				return fmt.Errorf("default tile %s: %w", d.Slug, err)
			}
			if err := audit.InsertAll(ctx, tx, evs); err != nil {
				return err
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
		if pgErr.ConstraintName == "launcher_versions_app_version_key" {
			return fieldError("version", "is published already")
		}
		return ErrSlugTaken
	case "23503":
		if pgErr.ConstraintName == "launcher_apps_updated_by_user_id_fkey" || pgErr.ConstraintName == "launcher_feedback_user_id_fkey" ||
			pgErr.ConstraintName == "launcher_pins_user_id_fkey" || pgErr.ConstraintName == "launcher_versions_published_by_user_id_fkey" ||
			pgErr.ConstraintName == "launcher_channels_updated_by_user_id_fkey" || pgErr.ConstraintName == "launcher_channel_choices_user_id_fkey" {
			return ErrActorNotFound
		}
		return ErrNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
