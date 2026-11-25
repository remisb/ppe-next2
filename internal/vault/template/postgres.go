package template

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores templates in vault.templates and
// vault.template_versions (migration 0063).
type PostgresRepository struct{ pool *pgxpool.Pool }

var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository is the template repository over pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

const columns = `t.id, t.type, t.name, t.language, t.current_version, t.retired_at, t.created_at, t.updated_at,
	t.created_by_user_id, t.updated_by_user_id, t.deleted_at`

func scanTemplate(row pgx.Row) (Template, error) {
	var t Template
	err := row.Scan(&t.ID, &t.Type, &t.Name, &t.Language, &t.Current, &t.RetiredAt, &t.CreatedAt, &t.UpdatedAt,
		&t.CreatedByUserID, &t.UpdatedByUserID, &t.DeletedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Template{}, ErrNotFound
	}
	t.Retired = t.RetiredAt != nil
	t.CreatedAt, t.UpdatedAt = t.CreatedAt.UTC(), t.UpdatedAt.UTC()
	return t, err
}

// versionsOf reads a template's versions, newest first.
func versionsOf(ctx context.Context, q querier, id uuid.UUID) ([]Version, error) {
	rows, err := q.Query(ctx, `SELECT number, state, kind, body, asked, body_sha256, updated_at, published_at, docx_key, docx_name, docx_size
		FROM vault.template_versions WHERE template_id = $1 ORDER BY number DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Version, 0)
	for rows.Next() {
		var v Version
		var body, asked []byte
		var key, name *string
		var size *int64
		if err := rows.Scan(&v.Number, &v.State, &v.Kind, &body, &asked, &v.BodySHA256, &v.UpdatedAt, &v.PublishedAt, &key, &name, &size); err != nil {
			return nil, err
		}
		if key != nil && name != nil && size != nil {
			v.Docx = &DocxFile{Key: *key, Name: *name, Size: *size}
		}
		if err := json.Unmarshal(body, &v.Body); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(asked, &v.Asked); err != nil {
			return nil, err
		}
		v.UpdatedAt = v.UpdatedAt.UTC()
		out = append(out, v)
	}
	return out, rows.Err()
}

func read(ctx context.Context, q querier, id uuid.UUID, lock bool) (Template, error) {
	sql := `SELECT ` + columns + ` FROM vault.templates t WHERE t.id = $1 AND t.deleted_at IS NULL`
	if lock {
		sql += ` FOR UPDATE`
	}
	t, err := scanTemplate(q.QueryRow(ctx, sql, id))
	if err != nil {
		return Template{}, err
	}
	t.Versions, err = versionsOf(ctx, q, id)
	return t, err
}

func writeVersion(ctx context.Context, tx pgx.Tx, id uuid.UUID, v Version, actor uuid.UUID) error {
	body, err := json.Marshal(v.Body)
	if err != nil {
		return err
	}
	asked, err := json.Marshal(v.Asked)
	if err != nil {
		return err
	}
	var publishedBy *uuid.UUID
	if v.PublishedAt != nil {
		publishedBy = &actor
	}
	kind := v.Kind
	if kind == "" {
		kind = KindBlocks
	}
	var key, name *string
	var size *int64
	if v.Docx != nil {
		key, name, size = &v.Docx.Key, &v.Docx.Name, &v.Docx.Size
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO vault.template_versions (template_id, number, state, body, asked, body_sha256, updated_at, updated_by_user_id,
			published_at, published_by_user_id, kind, docx_key, docx_name, docx_size)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		ON CONFLICT (template_id, number) DO UPDATE SET state = $3, body = $4, asked = $5, body_sha256 = $6,
			updated_at = $7, updated_by_user_id = $8, published_at = $9, published_by_user_id = $10,
			kind = $11, docx_key = $12, docx_name = $13, docx_size = $14`,
		id, v.Number, v.State, body, asked, v.BodySHA256, v.UpdatedAt, actor, v.PublishedAt, publishedBy, kind, key, name, size)
	return err
}

// Create inserts t, its first draft and ev.
func (r *PostgresRepository) Create(ctx context.Context, t Template, v Version, ev audit.Event) error {
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO vault.templates (id, type, name, language, created_at, created_by_user_id, updated_at, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $5, $6)`, t.ID, t.Type, t.Name, t.Language, t.CreatedAt, t.CreatedByUserID); err != nil {
			return err
		}
		if err := writeVersion(ctx, tx, t.ID, v, t.CreatedByUserID); err != nil {
			return err
		}
		return audit.Insert(ctx, tx, ev)
	})
	return translate(err)
}

// Get reads the live template with its versions.
func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Template, error) {
	return read(ctx, r.pool, id, false)
}

// List reads every live template with its versions, by type and name.
func (r *PostgresRepository) List(ctx context.Context) ([]Template, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+columns+` FROM vault.templates t WHERE t.deleted_at IS NULL ORDER BY t.type, lower(t.name), t.id`)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Template, error) { return scanTemplate(row) })
	if err != nil {
		return nil, err
	}
	for i := range list {
		if list[i].Versions, err = versionsOf(ctx, r.pool, list[i].ID); err != nil {
			return nil, err
		}
	}
	return list, nil
}

// Update locks the template, applies m and writes what it changed.
func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Template, error) {
	var out Template
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := read(ctx, tx, id, true)
		if err != nil {
			return err
		}
		next, v, evs, err := m(cur)
		if err != nil {
			return err
		}
		if len(evs) == 0 {
			out = cur
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE vault.templates SET name = $2, language = $3, current_version = $4, retired_at = $5,
			updated_at = $6, updated_by_user_id = $7 WHERE id = $1`,
			id, next.Name, next.Language, next.Current, next.RetiredAt, next.UpdatedAt, next.UpdatedByUserID); err != nil {
			return err
		}
		if v != nil {
			if err := writeVersion(ctx, tx, id, *v, next.UpdatedByUserID); err != nil {
				return err
			}
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out, err = read(ctx, tx, id, false)
		return err
	})
	return out, translate(err)
}

func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505":
		return ErrNameTaken
	case "23503":
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
