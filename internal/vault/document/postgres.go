package document

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/vault"
)

// PostgresRepository stores documents in schema vault (migration 0061).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository is the document repository over pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// docColumns are a document's own columns (d).
const docColumns = `d.id, d.type, d.title, d.number, d.document_date::text, d.valid_from::text, d.valid_until::text,
	d.origin, d.sealed, d.source_kind IS NOT NULL, d.requires, d.created_at, d.created_by_user_id, d.updated_at,
	d.updated_by_user_id, d.deleted_at, d.deleted_by_user_id`

// read reads the document with id, locked FOR UPDATE when lock, live or not
// as live says, with its versions and links.
func read(ctx context.Context, q querier, id uuid.UUID, live, lock bool) (Document, error) {
	sql := `SELECT ` + docColumns + ` FROM vault.documents d WHERE d.id = $1`
	if live {
		sql += ` AND d.deleted_at IS NULL`
	}
	if lock {
		sql += ` FOR UPDATE`
	}
	var d Document
	err := q.QueryRow(ctx, sql, id).Scan(&d.ID, &d.Type, &d.Title, &d.Number, &d.DocumentDate, &d.ValidFrom, &d.ValidUntil,
		&d.Origin, &d.Sealed, &d.Locked, &d.Requires, &d.CreatedAt, &d.CreatedByUserID, &d.UpdatedAt,
		&d.UpdatedByUserID, &d.DeletedAt, &d.DeletedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	if err != nil {
		return Document{}, err
	}
	d.CreatedAt, d.UpdatedAt = d.CreatedAt.UTC(), d.UpdatedAt.UTC()
	if d.Versions, err = versionsOf(ctx, q, id); err != nil {
		return Document{}, err
	}
	if d.Links, err = linksOf(ctx, q, id); err != nil {
		return Document{}, err
	}
	return d, nil
}

// versionsOf reads a document's versions, newest first, each with its main
// file, the text state and its creator's name.
func versionsOf(ctx context.Context, q querier, id uuid.UUID) ([]Version, error) {
	rows, err := q.Query(ctx, `
		SELECT v.id, v.number, v.origin, v.document_hash, v.note, v.created_at, v.created_by_user_id, coalesce(u.name, ''),
			f.id, f.object_key, f.file_name, f.content_type, f.size_bytes, f.sha256, f.sealed,
			coalesce(t.state, 'pending')
		FROM vault.versions v
		JOIN vault.files f ON f.version_id = v.id AND f.role = 'main'
		LEFT JOIN users u ON u.id = v.created_by_user_id
		LEFT JOIN vault.version_text t ON t.version_id = v.id
		WHERE v.document_id = $1
		ORDER BY v.number DESC`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Version, 0)
	for rows.Next() {
		var v Version
		f := &v.File
		if err := rows.Scan(&v.ID, &v.Number, &v.Origin, &v.DocumentHash, &v.Note, &v.CreatedAt, &v.CreatedByUserID, &v.CreatedByName,
			&f.ID, &f.ObjectKey, &f.FileName, &f.ContentType, &f.SizeBytes, &f.SHA256, &f.Sealed, &v.TextState); err != nil {
			return nil, err
		}
		v.CreatedAt = v.CreatedAt.UTC()
		out = append(out, v)
	}
	return out, rows.Err()
}

// linksOf reads a document's links by kind and name.
func linksOf(ctx context.Context, q querier, id uuid.UUID) ([]Link, error) {
	rows, err := q.Query(ctx, `SELECT subject_kind, subject_id, label, locked, requires FROM vault.links
		WHERE document_id = $1 ORDER BY array_position($2::text[], subject_kind), lower(label), subject_id`, id, kindOrder())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Link, 0)
	for rows.Next() {
		var l Link
		if err := rows.Scan(&l.Kind, &l.ID, &l.Label, &l.Locked, &l.Requires); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// kindOrder is vault.SubjectKinds as strings, for sorting links in SQL.
func kindOrder() []string {
	var out []string
	for _, k := range vault.SubjectKinds() {
		out = append(out, string(k))
	}
	return out
}

// insertLinks writes links of document id.
func insertLinks(ctx context.Context, tx pgx.Tx, id uuid.UUID, links []Link, at time.Time, actor uuid.UUID) error {
	for _, l := range links {
		var employee *uuid.UUID
		if l.Kind == vault.Employee {
			employee = &l.ID
		}
		reqs := l.Requires
		if reqs == nil {
			reqs = []string{}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO vault.links (document_id, subject_kind, subject_id, employee_id, label, requires, locked, created_at, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			id, l.Kind, l.ID, employee, l.Label, reqs, l.Locked, at, actor); err != nil {
			return err
		}
	}
	return nil
}

// insertVersion writes a version of document id with its main file and a
// pending text row.
func insertVersion(ctx context.Context, tx pgx.Tx, id uuid.UUID, v Version) error {
	if _, err := tx.Exec(ctx, `
		INSERT INTO vault.versions (id, document_id, number, origin, document_hash, note, created_at, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		v.ID, id, v.Number, v.Origin, v.DocumentHash, v.Note, v.CreatedAt, v.CreatedByUserID); err != nil {
		return err
	}
	f := v.File
	if _, err := tx.Exec(ctx, `
		INSERT INTO vault.files (id, version_id, role, object_key, file_name, content_type, size_bytes, sha256, sealed, created_at, created_by_user_id)
		VALUES ($1, $2, 'main', $3, $4, $5, $6, $7, $8, $9, $10)`,
		f.ID, v.ID, f.ObjectKey, f.FileName, f.ContentType, f.SizeBytes, f.SHA256, f.Sealed, v.CreatedAt, v.CreatedByUserID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO vault.version_text (version_id, state) VALUES ($1, 'pending')`, v.ID)
	return err
}

// refresh rebuilds document id's search vector.
func refresh(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	_, err := tx.Exec(ctx, `SELECT vault.refresh_search($1)`, id)
	return err
}

// Create inserts d with its first version, links and ev.
func (r *PostgresRepository) Create(ctx context.Context, d Document, links []Link, ev audit.Event) error {
	t, _ := vault.TypeOf(d.Type)
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO vault.documents (id, type, type_words, title, number, document_date, valid_from, valid_until, origin,
				sealed, requires, created_at, created_by_user_id, updated_at, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			d.ID, d.Type, t.Words, d.Title, d.Number, d.DocumentDate, d.ValidFrom, d.ValidUntil, d.Origin,
			d.Sealed, d.Requires, d.CreatedAt, d.CreatedByUserID, d.UpdatedAt, d.UpdatedByUserID); err != nil {
			return err
		}
		for _, v := range d.Versions {
			if err := insertVersion(ctx, tx, d.ID, v); err != nil {
				return err
			}
		}
		if err := insertLinks(ctx, tx, d.ID, links, d.CreatedAt, d.CreatedByUserID); err != nil {
			return err
		}
		if err := audit.Insert(ctx, tx, ev); err != nil {
			return err
		}
		return refresh(ctx, tx, d.ID)
	})
	return translate(err)
}

// Get reads the live document.
func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Document, error) {
	return read(ctx, r.pool, id, true, false)
}

// Update locks the live document, applies m and, when it returns events,
// writes its fields, replaces its links and records them.
func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Document, error) {
	var out Document
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := read(ctx, tx, id, true, true)
		if err != nil {
			return err
		}
		c, err := m(cur)
		if err != nil {
			return err
		}
		if len(c.Events) == 0 {
			out = cur
			return nil
		}
		n := c.Document
		if _, err := tx.Exec(ctx, `
			UPDATE vault.documents SET title = $2, document_date = $3, valid_from = $4, valid_until = $5, requires = $6,
				updated_at = $7, updated_by_user_id = $8, deleted_at = $9, deleted_by_user_id = $10
			WHERE id = $1`,
			id, n.Title, n.DocumentDate, n.ValidFrom, n.ValidUntil, n.Requires, n.UpdatedAt, n.UpdatedByUserID,
			n.DeletedAt, n.DeletedByUserID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM vault.links WHERE document_id = $1`, id); err != nil {
			return err
		}
		if err := insertLinks(ctx, tx, id, c.Links, n.UpdatedAt, n.UpdatedByUserID); err != nil {
			return err
		}
		if err := audit.InsertAll(ctx, tx, c.Events); err != nil {
			return err
		}
		if err := refresh(ctx, tx, id); err != nil {
			return err
		}
		out, err = read(ctx, tx, id, false, false)
		return err
	})
	return out, translate(err)
}

// AddVersion locks the live document, applies m and writes the version.
func (r *PostgresRepository) AddVersion(ctx context.Context, id uuid.UUID, m VersionMutation) (Document, error) {
	var out Document
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := read(ctx, tx, id, true, true)
		if err != nil {
			return err
		}
		v, evs, err := m(cur)
		if err != nil {
			return err
		}
		if err := insertVersion(ctx, tx, id, v); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE vault.documents SET updated_at = $2, updated_by_user_id = $3 WHERE id = $1`,
			id, v.CreatedAt, v.CreatedByUserID); err != nil {
			return err
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		if err := refresh(ctx, tx, id); err != nil {
			return err
		}
		out, err = read(ctx, tx, id, true, false)
		return err
	})
	return out, translate(err)
}

// tsQuery is words as a tsquery every word of which must match as a prefix
// ("zukausk:* & sert:*"), only letters and digits kept, so the syntax is
// always valid; "" for no word.
func tsQuery(words string) string {
	tokens := strings.FieldsFunc(strings.ToLower(words), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	if len(tokens) > 10 {
		tokens = tokens[:10]
	}
	parts := make([]string, 0, len(tokens))
	for _, t := range tokens {
		if r := []rune(t); len(r) > 50 {
			t = string(r[:50])
		}
		parts = append(parts, t+":*")
	}
	return strings.Join(parts, " & ")
}

// hitColumns are a search hit's columns (d).
const hitColumns = `d.id, d.type, d.title, d.number, d.document_date::text, d.valid_until::text, d.origin, d.sealed,
	(SELECT count(*) FROM vault.versions v WHERE v.document_id = d.id),
	coalesce((SELECT f.content_type FROM vault.versions v JOIN vault.files f ON f.version_id = v.id AND f.role = 'main'
		WHERE v.document_id = d.id ORDER BY v.number DESC LIMIT 1), ''),
	coalesce((SELECT json_agg(json_build_object('kind', l.subject_kind, 'id', l.subject_id, 'label', l.label, 'locked', l.locked)
		ORDER BY array_position($1::text[], l.subject_kind), lower(l.label)) FROM vault.links l WHERE l.document_id = d.id), '[]'),
	d.created_at, d.updated_at, count(*) OVER ()`

// nearThreshold is how alike (pg_trgm's word_similarity) the words must be to
// a title or a linked name to be offered when nothing matches them: low
// enough for a transposed letter in a long name (Zukauskiate is 0.58 of
// Žukauskaitė), high enough that a short word matches little.
const nearThreshold = 0.45

// Search reads a page of live documents whose requires perms hold, matching
// q's words as prefixes ranked by weight; when the words match nothing, near
// spellings of the title and links' names (trigrams) instead.
func (r *PostgresRepository) Search(ctx context.Context, q Query, perms []string) (Page, error) {
	if perms == nil {
		perms = []string{}
	}
	args := []any{kindOrder(), perms}
	where := []string{"d.deleted_at IS NULL", "d.requires <@ $2::text[]"}
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	if len(q.Types) > 0 {
		where = append(where, "d.type = ANY("+arg(q.Types)+"::text[])")
	}
	if q.Subject != nil {
		where = append(where, "EXISTS (SELECT 1 FROM vault.links l WHERE l.document_id = d.id AND l.subject_kind = "+
			arg(string(q.Subject.Kind))+" AND l.subject_id = "+arg(q.Subject.ID)+")")
	}
	offset := (q.Page - 1) * pageSize
	run := func(extraWhere []string, order string, extraArgs ...any) (Page, error) {
		a := append(append([]any{}, args...), extraArgs...)
		sql := `SELECT ` + hitColumns + ` FROM vault.documents d WHERE ` + strings.Join(append(append([]string{}, where...), extraWhere...), " AND ") +
			` ORDER BY ` + order + fmt.Sprintf(` LIMIT %d OFFSET %d`, pageSize, offset)
		rows, err := r.pool.Query(ctx, sql, a...)
		if err != nil {
			return Page{}, err
		}
		defer rows.Close()
		p := Page{Documents: make([]Hit, 0), Page: q.Page, PageSize: pageSize}
		for rows.Next() {
			var h Hit
			var links []byte
			if err := rows.Scan(&h.ID, &h.Type, &h.Title, &h.Number, &h.DocumentDate, &h.ValidUntil, &h.Origin, &h.Sealed,
				&h.Versions, &h.ContentType, &links, &h.CreatedAt, &h.UpdatedAt, &p.Total); err != nil {
				return Page{}, err
			}
			h.CreatedAt, h.UpdatedAt = h.CreatedAt.UTC(), h.UpdatedAt.UTC()
			if err := json.Unmarshal(links, &h.Links); err != nil {
				return Page{}, err
			}
			p.Documents = append(p.Documents, h)
		}
		return p, rows.Err()
	}
	words := tsQuery(q.Words)
	if words == "" {
		return run(nil, "d.created_at DESC, d.id")
	}
	n := len(args) + 1
	query := fmt.Sprintf("to_tsquery('vault.ppe', $%d)", n)
	p, err := run([]string{"d.search @@ " + query}, "ts_rank_cd(d.search, "+query+") DESC, d.created_at DESC, d.id", words)
	if err != nil || p.Total > 0 || q.Page > 1 {
		return p, err
	}
	// Nothing matched: near spellings of the title and the links' names.
	near := fmt.Sprintf(`word_similarity(vault.unaccent(lower($%d)), vault.unaccent(lower(d.title || ' ' || coalesce(
		(SELECT string_agg(l.label, ' ') FROM vault.links l WHERE l.document_id = d.id), '')))) >= %v`, n, nearThreshold)
	order := fmt.Sprintf(`word_similarity(vault.unaccent(lower($%d)), vault.unaccent(lower(d.title || ' ' || coalesce(
		(SELECT string_agg(l.label, ' ') FROM vault.links l WHERE l.document_id = d.id), '')))) DESC, d.created_at DESC, d.id`, n)
	p, err = run([]string{near}, order, strings.TrimSpace(q.Words))
	p.Near = true
	return p, err
}

// Subjects reads every subject a live document is linked to.
func (r *PostgresRepository) Subjects(ctx context.Context) ([]Subject, error) {
	rows, err := r.pool.Query(ctx, `SELECT DISTINCT l.subject_kind, l.subject_id FROM vault.links l
		JOIN vault.documents d ON d.id = l.document_id AND d.deleted_at IS NULL ORDER BY 1, 2`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Subject, 0)
	for rows.Next() {
		var s Subject
		if err := rows.Scan(&s.Kind, &s.ID); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Relabel sets s's links' label, rebuilding the search of their documents.
func (r *PostgresRepository) Relabel(ctx context.Context, s Subject, label string) (int, error) {
	n := 0
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `UPDATE vault.links SET label = $3
			WHERE subject_kind = $1 AND subject_id = $2 AND label <> $3 RETURNING document_id`, s.Kind, s.ID, label)
		if err != nil {
			return err
		}
		ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil {
			return err
		}
		for _, id := range ids {
			if err := refresh(ctx, tx, id); err != nil {
				return err
			}
		}
		n = len(ids)
		return nil
	})
	return n, translate(err)
}

// translate maps Postgres errors to sentinels: a foreign key is the actor
// (ErrActorNotFound) or a linked employee (ErrSubjectNotFound), a CHECK
// ErrInvalid naming the constraint.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23503":
		if strings.Contains(pgErr.ConstraintName, "employee") {
			return ErrSubjectNotFound
		}
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	case "23505":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
