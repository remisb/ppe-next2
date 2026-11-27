package launcher

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresRepository stores the registry in schema launcher: apps, pins and
// feedback, and published apps' versions, channels and channel_choices. It
// reads no table outside its schema; the host's audit trail is written
// through an Auditor, in the same transaction.
type PostgresRepository struct {
	pool  *pgxpool.Pool
	cfg   Config
	audit Auditor
}

var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository is the registry over pool for the host's cfg,
// recording its events through audit.
func NewPostgresRepository(pool *pgxpool.Pool, cfg Config, audit Auditor) *PostgresRepository {
	return &PostgresRepository{pool: pool, cfg: cfg, audit: audit}
}

// columns are launcher.apps' columns scan reads, in its order.
const columns = `id, slug, kind, parent, app_group, icon, color, href, tier, stage, names, any_of,
	position, stable_follows_deploys, created_at, updated_at, updated_by_user_id`

// audienceOf is an audience as stored: none is an empty array, never NULL.
func audienceOf(anyOf []string) []string {
	if anyOf == nil {
		return []string{}
	}
	return anyOf
}

// byPosition orders tiles as the launcher shows them.
const byPosition = ` ORDER BY position, slug`

// scan reads a row of columns, times in UTC, keeping only the host's
// permissions; no row is ErrNotFound.
func (r *PostgresRepository) scan(row pgx.Row) (App, error) {
	var a App
	var anyOf []string
	err := row.Scan(&a.ID, &a.Slug, &a.Kind, &a.Parent, &a.Group, &a.Icon, &a.Color, &a.Href, &a.Tier, &a.Stage,
		&a.Names, &anyOf, &a.Position, &a.StableFollowsDeploys, &a.CreatedAt, &a.UpdatedAt, &a.UpdatedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return App{}, ErrNotFound
	}
	if err != nil {
		return App{}, err
	}
	a.AnyOf = r.cfg.Known(anyOf)
	a.CreatedAt, a.UpdatedAt = a.CreatedAt.UTC(), a.UpdatedAt.UTC()
	return a, nil
}

// query reads every tile sql returns, from the pool or a transaction.
func (r *PostgresRepository) query(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, sql string, args ...any) ([]App, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]App, 0)
	for rows.Next() {
		a, err := r.scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// List reads every tile, retired ones included, by position.
func (r *PostgresRepository) List(ctx context.Context) ([]App, error) {
	return r.query(ctx, r.pool, `SELECT `+columns+` FROM launcher.apps`+byPosition)
}

// Get reads the tile with the slug, or ErrNotFound.
func (r *PostgresRepository) Get(ctx context.Context, slug string) (App, error) {
	return r.scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM launcher.apps WHERE slug = $1`, slug))
}

// insert adds a's row, onConflict appended to the statement.
func insert(ctx context.Context, tx pgx.Tx, a App, onConflict string) (pgconn.CommandTag, error) {
	return tx.Exec(ctx, `
		INSERT INTO launcher.apps (id, slug, kind, parent, app_group, icon, color, href, tier, stage, names,
			any_of, position, created_at, updated_at, updated_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`+onConflict,
		a.ID, a.Slug, a.Kind, a.Parent, a.Group, a.Icon, a.Color, a.Href, a.Tier, a.Stage, a.Names,
		audienceOf(a.AnyOf), a.Position, a.CreatedAt, a.UpdatedAt, a.UpdatedByUserID)
}

// Create inserts the tile and ev in one transaction, under a table lock, at
// least one step after the last tile.
func (r *PostgresRepository) Create(ctx context.Context, a App, ev Event) (App, error) {
	var out App
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		// One new tile at a time, so two registered at once never share a place.
		if _, err := tx.Exec(ctx, `LOCK TABLE launcher.apps IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return err
		}
		var last int
		if err := tx.QueryRow(ctx, `SELECT coalesce(max(position), 0) FROM launcher.apps`).Scan(&last); err != nil {
			return err
		}
		a.Position = max(a.Position, last+positionStep)
		if _, err := insert(ctx, tx, a, ""); err != nil {
			return err
		}
		if err := r.audit.Record(ctx, tx, []Event{ev}); err != nil {
			return err
		}
		var err error
		out, err = r.scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM launcher.apps WHERE id = $1`, a.ID))
		return err
	})
	return out, translate(err)
}

// Update locks the tile, applies m and writes it with its events; no events,
// no write.
func (r *PostgresRepository) Update(ctx context.Context, slug string, m Mutation) (App, error) {
	var out App
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := r.scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM launcher.apps WHERE slug = $1 FOR UPDATE`, slug))
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
			UPDATE launcher.apps SET parent = $2, app_group = $3, icon = $4, color = $5, href = $6, tier = $7, stage = $8,
				names = $9, any_of = $10, updated_at = $11, updated_by_user_id = $12, stable_follows_deploys = $13
			WHERE id = $1`,
			cur.ID, next.Parent, next.Group, next.Icon, next.Color, next.Href, next.Tier, next.Stage,
			next.Names, audienceOf(next.AnyOf), next.UpdatedAt, next.UpdatedByUserID, next.StableFollowsDeploys); err != nil {
			return err
		}
		out = next
		return r.audit.Record(ctx, tx, evs)
	})
	return out, translate(err)
}

// Reorder locks every tile, applies m, writes the changed positions and the
// events, and reads every tile again.
func (r *PostgresRepository) Reorder(ctx context.Context, m OrderMutation) ([]App, error) {
	var out []App
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := r.query(ctx, tx, `SELECT `+columns+` FROM launcher.apps`+byPosition+` FOR UPDATE`)
		if err != nil {
			return err
		}
		changed, evs, err := m(cur)
		if err != nil {
			return err
		}
		for _, a := range changed {
			if _, err := tx.Exec(ctx, `UPDATE launcher.apps SET position = $2, updated_at = $3, updated_by_user_id = $4 WHERE id = $1`,
				a.ID, a.Position, a.UpdatedAt, a.UpdatedByUserID); err != nil {
				return err
			}
		}
		if err := r.audit.Record(ctx, tx, evs); err != nil {
			return err
		}
		out, err = r.query(ctx, tx, `SELECT `+columns+` FROM launcher.apps`+byPosition)
		return err
	})
	return out, translate(err)
}

// Pins reads the slugs user pinned, in the order pinned.
func (r *PostgresRepository) Pins(ctx context.Context, user uuid.UUID) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT a.slug FROM launcher.pins p JOIN launcher.apps a ON a.id = p.app_id
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

// SetPins replaces user's pins under pinsLock, numbering them from 1.
func (r *PostgresRepository) SetPins(ctx context.Context, user uuid.UUID, apps []uuid.UUID) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1, hashtext($2::text))`, pinsLock, user); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM launcher.pins WHERE user_id = $1`, user); err != nil {
			return err
		}
		for i, id := range apps {
			if _, err := tx.Exec(ctx, `INSERT INTO launcher.pins (user_id, app_id, position) VALUES ($1, $2, $3)`, user, id, i+1); err != nil {
				return err
			}
		}
		return nil
	}))
}

// versionColumns are launcher.versions' columns, as scanVersion reads them.
const versionColumns = `id, app_id, version, profile, capabilities, commit, published_at, published_by_user_id`

// scanVersion reads a row of versionColumns, its time in UTC.
func scanVersion(row pgx.CollectableRow) (Version, error) {
	var v Version
	err := row.Scan(&v.ID, &v.AppID, &v.Version, &v.Profile, &v.Capabilities, &v.Commit, &v.PublishedAt, &v.PublishedByUserID)
	v.PublishedAt = v.PublishedAt.UTC()
	return v, err
}

// Versions reads an app's versions, newest first.
func (r *PostgresRepository) Versions(ctx context.Context, app uuid.UUID) ([]Version, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+versionColumns+` FROM launcher.versions WHERE app_id = $1 ORDER BY published_at DESC, version DESC`, app)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, scanVersion)
	if out == nil {
		out = []Version{}
	}
	return out, err
}

// AddVersion inserts the version and ev in one transaction; a version
// recorded already is ErrInvalid.
func (r *PostgresRepository) AddVersion(ctx context.Context, v Version, ev Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO launcher.versions (`+versionColumns+`) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			v.ID, v.AppID, v.Version, v.Profile, v.Capabilities, v.Commit, v.PublishedAt, v.PublishedByUserID); err != nil {
			return err
		}
		return r.audit.Record(ctx, tx, []Event{ev})
	}))
}

// PruneVersions locks the app, reads its versions and channels, applies m and
// deletes the versions it picks with its event.
func (r *PostgresRepository) PruneVersions(ctx context.Context, app uuid.UUID, m PruneMutation) ([]Version, error) {
	var removed []Version
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		// The app's row first, as PutChannel locks it: no channel moves onto a version while it goes.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM launcher.apps WHERE id = $1 FOR UPDATE`, app); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT `+versionColumns+` FROM launcher.versions WHERE app_id = $1 ORDER BY published_at DESC, version DESC`, app)
		if err != nil {
			return err
		}
		versions, err := pgx.CollectRows(rows, scanVersion)
		if err != nil {
			return err
		}
		rows, err = tx.Query(ctx, `SELECT `+channelColumns+` FROM launcher.channels c JOIN launcher.versions v ON v.id = c.version_id WHERE c.app_id = $1`+channelOrder, app)
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
		if _, err := tx.Exec(ctx, `DELETE FROM launcher.versions WHERE app_id = $1 AND id = ANY($2)`, app, ids); err != nil {
			return err
		}
		removed = remove
		if ev == nil {
			return nil
		}
		return r.audit.Record(ctx, tx, []Event{*ev})
	})
	return removed, translate(err)
}

// channelColumns are a channel's (c), with its version's name and date (v).
const channelColumns = `c.id, c.app_id, c.name, c.version_id, v.version, v.published_at, c.updated_at, c.updated_by_user_id`

// channelOrder: Stable, Beta, Preview.
const channelOrder = ` ORDER BY c.app_id, array_position(ARRAY['stable','beta','preview'], c.name) NULLS LAST, c.name`

// scanChannel reads a row of channelColumns, times in UTC.
func scanChannel(row pgx.Row) (Channel, error) {
	var c Channel
	err := row.Scan(&c.ID, &c.AppID, &c.Name, &c.VersionID, &c.Version, &c.PublishedAt, &c.UpdatedAt, &c.UpdatedByUserID)
	c.PublishedAt, c.UpdatedAt = c.PublishedAt.UTC(), c.UpdatedAt.UTC()
	return c, err
}

// Channels reads every app's channels.
func (r *PostgresRepository) Channels(ctx context.Context) ([]Channel, error) {
	return r.channels(ctx, ``)
}

// AppChannels reads one app's channels.
func (r *PostgresRepository) AppChannels(ctx context.Context, app uuid.UUID) ([]Channel, error) {
	return r.channels(ctx, ` WHERE c.app_id = $1`, app)
}

// channels reads the channels where selects, each with its version, in channelOrder.
func (r *PostgresRepository) channels(ctx context.Context, where string, args ...any) ([]Channel, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+channelColumns+` FROM launcher.channels c JOIN launcher.versions v ON v.id = c.version_id`+where+channelOrder, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Channel, error) { return scanChannel(row) })
	if out == nil {
		out = []Channel{}
	}
	return out, err
}

// PutChannel locks the app and its channel by that name, applies m, and
// inserts or updates the channel with its events; no events, no write.
func (r *PostgresRepository) PutChannel(ctx context.Context, app uuid.UUID, name string, m ChannelMutation) (Channel, error) {
	var out Channel
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		// The app's row, so two first channels of one name never race.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM launcher.apps WHERE id = $1 FOR UPDATE`, app); err != nil {
			return err
		}
		var cur *Channel
		c, err := scanChannel(tx.QueryRow(ctx, `SELECT `+channelColumns+` FROM launcher.channels c JOIN launcher.versions v ON v.id = c.version_id
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
			INSERT INTO launcher.channels (id, app_id, name, version_id, updated_at, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (app_id, name) DO UPDATE SET version_id = $4, updated_at = $5, updated_by_user_id = $6`,
			next.ID, app, name, next.VersionID, next.UpdatedAt, next.UpdatedByUserID); err != nil {
			return err
		}
		return r.audit.Record(ctx, tx, evs)
	})
	return out, translate(err)
}

// Choices reads the channel user chose for each app, by app id.
func (r *PostgresRepository) Choices(ctx context.Context, user uuid.UUID) (map[uuid.UUID]string, error) {
	rows, err := r.pool.Query(ctx, `SELECT app_id, channel FROM launcher.channel_choices WHERE user_id = $1`, user)
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

// SetChoice keeps user's channel for the app; "" deletes the choice.
func (r *PostgresRepository) SetChoice(ctx context.Context, user, app uuid.UUID, channel string) error {
	if channel == "" {
		_, err := r.pool.Exec(ctx, `DELETE FROM launcher.channel_choices WHERE user_id = $1 AND app_id = $2`, user, app)
		return translate(err)
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO launcher.channel_choices (user_id, app_id, channel) VALUES ($1, $2, $3)
		ON CONFLICT (user_id, app_id) DO UPDATE SET channel = $3`, user, app, channel)
	return translate(err)
}

// AddFeedback inserts f.
func (r *PostgresRepository) AddFeedback(ctx context.Context, f Feedback) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO launcher.feedback (id, app_id, user_id, rating, text, device, language, version, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		f.ID, f.AppID, f.UserID, f.Rating, f.Text, f.Device, f.Language, f.Version, f.CreatedAt)
	return translate(err)
}

// Feedback reads an app's feedback, newest first; the service names senders.
func (r *PostgresRepository) Feedback(ctx context.Context, app uuid.UUID) ([]Feedback, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id, app_id, user_id, rating, text, device, language, version, created_at
		FROM launcher.feedback WHERE app_id = $1 ORDER BY created_at DESC, id`, app)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Feedback, error) {
		var f Feedback
		err := row.Scan(&f.ID, &f.AppID, &f.UserID, &f.Rating, &f.Text, &f.Device, &f.Language, &f.Version, &f.CreatedAt)
		f.CreatedAt = f.CreatedAt.UTC()
		return f, err
	})
	if out == nil {
		out = []Feedback{}
	}
	return out, err
}

// EnsureDefaults brings the registry in line with the host's default tiles
// at start-up (and after a test empties it). Code owns a default tile until an administrator
// changes it: a missing default is inserted, last; one no administrator has
// touched (updated_by_user_id is NULL) takes the code's fields if they
// differ, recorded as app.changed and app.audience_changed by no one; one an
// administrator edited, moved or switched is left as it is. Its place in the
// order is never changed here.
func (r *PostgresRepository) EnsureDefaults(ctx context.Context, defaults []App) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		// One start-up at a time, so two never number the same new tiles.
		if _, err := tx.Exec(ctx, `LOCK TABLE launcher.apps IN SHARE ROW EXCLUSIVE MODE`); err != nil {
			return err
		}
		have, err := r.query(ctx, tx, `SELECT `+columns+` FROM launcher.apps`+byPosition)
		if err != nil {
			return err
		}
		last := 0
		for _, a := range have {
			last = max(last, a.Position)
		}
		now := time.Now().UTC().Truncate(time.Microsecond)
		for _, d := range defaults {
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
			next.Tier, next.Stage, next.Names, next.AnyOf = d.Tier, d.Stage, d.Names, r.cfg.Known(d.AnyOf)
			var evs []Event
			if before, after := shown(cur), shown(next); !maps.Equal(before, after) {
				ev, err := newEvent(uuid.New(), nil, EventChanged, auditEntity, cur.ID, now, before, after)
				if err != nil {
					return err
				}
				evs = append(evs, ev)
			}
			if !slices.Equal(cur.AnyOf, next.AnyOf) {
				ev, err := newEvent(uuid.New(), nil, EventAudienceChanged, auditEntity, cur.ID, now,
					audience{cur.AnyOf}, audience{next.AnyOf})
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
				UPDATE launcher.apps SET parent = $2, app_group = $3, icon = $4, color = $5, href = $6, tier = $7, stage = $8,
					names = $9, any_of = $10, updated_at = $11
				WHERE id = $1`,
				cur.ID, next.Parent, next.Group, next.Icon, next.Color, next.Href, next.Tier, next.Stage,
				next.Names, audienceOf(next.AnyOf), now); err != nil {
				return fmt.Errorf("default tile %s: %w", d.Slug, err)
			}
			if err := r.audit.Record(ctx, tx, evs); err != nil {
				return err
			}
		}
		return nil
	})
}

// ownKeys are the schema's own foreign keys, to a tile or a version; any
// other is one the host added to its users table.
var ownKeys = []string{
	"pins_app_id_fkey", "feedback_app_id_fkey", "versions_app_id_fkey",
	"channels_app_id_fkey", "channels_version_id_fkey", "channel_choices_app_id_fkey",
}

// translate maps Postgres errors onto the domain's sentinels.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505": // unique_violation: a version recorded twice, else a tile's slug
		if pgErr.ConstraintName == "versions_app_version_key" {
			return fieldError("version", "is published already")
		}
		return ErrSlugTaken
	case "23503": // foreign_key_violation: a tile or version is gone, else the host's user is
		if slices.Contains(ownKeys, pgErr.ConstraintName) {
			return ErrNotFound
		}
		return ErrActorNotFound
	case "23514": // check_violation: the service validates first, so this is a bug
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
