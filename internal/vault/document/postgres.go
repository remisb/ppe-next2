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
	"github.com/remisb/ppe-next2/internal/outbox"
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
	d.updated_by_user_id, d.deleted_at, d.deleted_by_user_id, d.retain_until::text, d.hold_until::text, d.hold_reason,
	d.title_sealed, k.sealed_key, coalesce(k.key_id, 0), d.template_id, d.template_version`

// read reads the document with id, locked FOR UPDATE when lock, live or not
// as live says, with its versions and links.
func read(ctx context.Context, q querier, id uuid.UUID, live, lock bool) (Document, error) {
	sql := `SELECT ` + docColumns + ` FROM vault.documents d LEFT JOIN vault.document_keys k ON k.document_id = d.id
		WHERE d.id = $1 AND d.shredded_at IS NULL`
	if live {
		sql += ` AND d.deleted_at IS NULL`
	}
	if lock {
		sql += ` FOR UPDATE OF d`
	}
	var d Document
	err := q.QueryRow(ctx, sql, id).Scan(&d.ID, &d.Type, &d.Title, &d.Number, &d.DocumentDate, &d.ValidFrom, &d.ValidUntil,
		&d.Origin, &d.Sealed, &d.Locked, &d.Requires, &d.CreatedAt, &d.CreatedByUserID, &d.UpdatedAt,
		&d.UpdatedByUserID, &d.DeletedAt, &d.DeletedByUserID, &d.RetainUntil, &d.HoldUntil, &d.HoldReason,
		&d.TitleSealed, &d.Key, &d.KeyID, &d.TemplateID, &d.TemplateVersion)
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
			coalesce(t.state, 'pending'), t.method, t.language, t.pages, t.error, v.data_sealed, v.data
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
			&f.ID, &f.ObjectKey, &f.FileName, &f.ContentType, &f.SizeBytes, &f.SHA256, &f.Sealed, &v.TextState, &v.TextMethod, &v.TextLanguage, &v.TextPages, &v.TextError,
			&v.DataSealed, &v.Data); err != nil {
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
		INSERT INTO vault.versions (id, document_id, number, origin, document_hash, note, data_sealed, data, created_at, created_by_user_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		v.ID, id, v.Number, v.Origin, v.DocumentHash, v.Note, v.DataSealed, nullJSON(v.Data), v.CreatedAt, v.CreatedByUserID); err != nil {
		return err
	}
	f := v.File
	if _, err := tx.Exec(ctx, `
		INSERT INTO vault.files (id, version_id, role, object_key, file_name, content_type, size_bytes, sha256, sealed, created_at, created_by_user_id)
		VALUES ($1, $2, 'main', $3, $4, $5, $6, $7, $8, $9, $10)`,
		f.ID, v.ID, f.ObjectKey, f.FileName, f.ContentType, f.SizeBytes, f.SHA256, f.Sealed, v.CreatedAt, v.CreatedByUserID); err != nil {
		return err
	}
	if v.Text == "" {
		// Its words are read by the worker: the job is written with the version.
		if _, err := tx.Exec(ctx, `INSERT INTO vault.version_text (version_id, state) VALUES ($1, 'pending')`, v.ID); err != nil {
			return err
		}
		kind, key, payload := readTextFor(v.ID)
		return outbox.Insert(ctx, tx, kind, key, payload, v.CreatedAt)
	}
	// A generated version's words are known: read already.
	_, err := tx.Exec(ctx, `
		INSERT INTO vault.version_text (version_id, state, method, content, tsv, read_at)
		SELECT $1::uuid, 'read', 'blocks', CASE WHEN $3::boolean THEN NULL ELSE $2::text END, `+textVector+`, $4`,
		v.ID, v.Text, f.Sealed, v.CreatedAt)
	return err
}

// textVector is the search words of text $2: a sealed one's ($3) only the
// words that hold no digit (codes, sums), and its text is not kept.
const textVector = `CASE WHEN $3::boolean THEN array_to_tsvector(coalesce(
		(SELECT array_agg(w) FROM unnest(tsvector_to_array(to_tsvector('vault.ppe', $2::text))) AS w WHERE w !~ '[0-9]'), '{}'))
	ELSE to_tsvector('vault.ppe', $2::text) END`

// nullJSON keeps absent data as SQL NULL.
func nullJSON(b json.RawMessage) any {
	if len(b) == 0 {
		return nil
	}
	return []byte(b)
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
				sealed, requires, created_at, created_by_user_id, updated_at, updated_by_user_id, title_sealed, template_id, template_version)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
			d.ID, d.Type, t.Words, d.Title, d.Number, d.DocumentDate, d.ValidFrom, d.ValidUntil, d.Origin,
			d.Sealed, d.Requires, d.CreatedAt, d.CreatedByUserID, d.UpdatedAt, d.UpdatedByUserID, d.TitleSealed,
			d.TemplateID, d.TemplateVersion); err != nil {
			return err
		}
		if d.Sealed {
			if _, err := tx.Exec(ctx, `INSERT INTO vault.document_keys (document_id, sealed_key, key_id, created_at) VALUES ($1, $2, $3, $4)`,
				d.ID, d.Key, d.KeyID, d.CreatedAt); err != nil {
				return err
			}
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
				updated_at = $7, updated_by_user_id = $8, deleted_at = $9, deleted_by_user_id = $10, title_sealed = $11,
				hold_until = $12, hold_reason = $13
			WHERE id = $1`,
			id, n.Title, n.DocumentDate, n.ValidFrom, n.ValidUntil, n.Requires, n.UpdatedAt, n.UpdatedByUserID,
			n.DeletedAt, n.DeletedByUserID, n.TitleSealed, n.HoldUntil, n.HoldReason); err != nil {
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
	where := []string{"d.deleted_at IS NULL", "d.shredded_at IS NULL", "d.requires <@ $2::text[]"}
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
		JOIN vault.documents d ON d.id = l.document_id AND d.deleted_at IS NULL AND d.shredded_at IS NULL ORDER BY 1, 2`)
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

// NextNumber takes the next number of typ in year.
func (r *PostgresRepository) NextNumber(ctx context.Context, typ string, year int) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `INSERT INTO vault.document_number_counters (type, year, last) VALUES ($1, $2, 1)
		ON CONFLICT (type, year) DO UPDATE SET last = vault.document_number_counters.last + 1 RETURNING last`, typ, year).Scan(&n)
	return n, err
}

// Record writes ev alone.
func (r *PostgresRepository) Record(ctx context.Context, ev audit.Event) error {
	return audit.Insert(ctx, r.pool, ev)
}

// Sealed reads the sealed documents not shredded, removed ones too, with
// their linked employees.
func (r *PostgresRepository) Sealed(ctx context.Context) ([]Candidate, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT d.id, d.type, d.number, d.document_date::text, d.retain_until::text, d.hold_until::text, d.deleted_at IS NOT NULL,
			coalesce((SELECT array_agg(l.employee_id ORDER BY l.employee_id) FROM vault.links l
				WHERE l.document_id = d.id AND l.employee_id IS NOT NULL), '{}')
		FROM vault.documents d WHERE d.sealed AND d.shredded_at IS NULL ORDER BY d.created_at, d.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Candidate, 0)
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(&c.ID, &c.Type, &c.Number, &c.DocumentDate, &c.RetainUntil, &c.HoldUntil, &c.Removed, &c.Employees); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// SetRetainUntil sets a document's retain_until.
func (r *PostgresRepository) SetRetainUntil(ctx context.Context, id uuid.UUID, day *string) error {
	_, err := r.pool.Exec(ctx, `UPDATE vault.documents SET retain_until = $2 WHERE id = $1`, id, day)
	return err
}

// Shred runs vault.shred_document and records ev in one transaction.
func (r *PostgresRepository) Shred(ctx context.Context, id uuid.UUID, at time.Time, day string, ev audit.Event) ([]string, error) {
	var keys []string
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `SELECT vault.shred_document($1, $2, $3::date)`, id, at, day)
		if err != nil {
			return err
		}
		if keys, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		return audit.Insert(ctx, tx, ev)
	})
	return keys, translate(err)
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

// VersionDocument is the document version is of.
func (r *PostgresRepository) VersionDocument(ctx context.Context, version uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.pool.QueryRow(ctx, `SELECT document_id FROM vault.versions WHERE id = $1`, version).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	return id, err
}

// SetText writes version's text row and rebuilds its document's search; the
// text, method and the rest only when it was read.
func (r *PostgresRepository) SetText(ctx context.Context, version uuid.UUID, t TextUpdate) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var read *time.Time
		if t.State != TextReading {
			read = &t.At
		}
		var content *string
		if t.State == TextRead {
			content = &t.Content
		}
		// Reading or failing keeps what an earlier reading found; reading it
		// replaces it, and finding nothing clears it.
		tag, err := tx.Exec(ctx, `
			UPDATE vault.version_text SET state = $4,
				method = CASE WHEN $4 = 'read' THEN $5 WHEN $4 IN ('none', 'skipped') THEN NULL ELSE method END,
				language = CASE WHEN $4 = 'read' THEN $6 WHEN $4 IN ('none', 'skipped') THEN NULL ELSE language END,
				pages = CASE WHEN $4 = 'read' THEN $7 WHEN $4 IN ('none', 'skipped') THEN NULL ELSE pages END,
				content = CASE WHEN $4 = 'read' THEN (CASE WHEN $3::boolean THEN NULL ELSE $2::text END)
					WHEN $4 IN ('none', 'skipped') THEN NULL ELSE content END,
				tsv = CASE WHEN $4 = 'read' THEN `+textVector+` WHEN $4 IN ('none', 'skipped') THEN NULL ELSE tsv END,
				read_at = coalesce($8, read_at), error = $9
			WHERE version_id = $1`,
			version, content, t.Sealed, t.State, nullText(t.Method), nullText(t.Language), nullPages(t), read, nullText(t.Error))
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		if t.State == TextReading {
			return nil
		}
		_, err = tx.Exec(ctx, `SELECT vault.refresh_search(document_id) FROM vault.versions WHERE id = $1`, version)
		return err
	})
}

func nullText(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func nullPages(t TextUpdate) *int {
	if t.State != TextRead {
		return nil
	}
	return &t.Pages
}

// ReadAgain makes version's text pending again, keeping its words until it
// is read, and writes its job.
func (r *PostgresRepository) ReadAgain(ctx context.Context, version uuid.UUID, at time.Time) error {
	return pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE vault.version_text SET state = 'pending', error = NULL WHERE version_id = $1`, version)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return ErrNotFound
		}
		kind, key, payload := readTextFor(version)
		return outbox.Insert(ctx, tx, kind, key, payload, at)
	})
}

// QueueUnread writes a job for each live, unshredded version waiting for its
// text; one already queued is left as it is.
func (r *PostgresRepository) QueueUnread(ctx context.Context, failed bool, at time.Time) (int64, error) {
	states := []string{TextPending, TextReading}
	if failed {
		states = append(states, TextFailed)
	}
	var n int64
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if failed {
			if _, err := tx.Exec(ctx, `UPDATE vault.version_text SET state = 'pending', error = NULL WHERE state = 'failed'`); err != nil {
				return err
			}
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO outbox.jobs (id, kind, key, payload, state, run_after, created_at)
			SELECT gen_random_uuid(), $1, t.version_id::text, jsonb_build_object('version', t.version_id), 'pending', $3, $3
			FROM vault.version_text t
			JOIN vault.versions v ON v.id = t.version_id
			JOIN vault.documents d ON d.id = v.document_id
			WHERE t.state = ANY($2) AND d.deleted_at IS NULL AND d.shredded_at IS NULL
			ON CONFLICT (kind, key) WHERE state IN ('pending', 'running') DO NOTHING`, KindReadText, states, at)
		if err != nil {
			return err
		}
		n = tag.RowsAffected()
		_, err = tx.Exec(ctx, `SELECT pg_notify($1, $2)`, outbox.Channel, KindReadText)
		return err
	})
	return n, err
}
