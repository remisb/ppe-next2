package asset

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores assets, their numbers and assignments (migration
// 0029). The employee's name on an assignment is read from employees, the
// shared kernel, as orders read it.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const assetColumns = `a.id, a.kind, a.category, a.inventory_no, a.name, a.serial_no, a.sim_no, a.phone_no, a.provider, a.plan,
	a.non_return_value_cents, a.currency, a.connection_status, a.received_date::text, a.comment, a.written_off_at,
	a.written_off_by_user_id, a.created_at, a.updated_at, a.deleted_at, a.created_by_user_id, a.updated_by_user_id,
	a.deleted_by_user_id`

const assignmentColumns = `o.id, o.asset_id, o.employee_id, o.given_date::text, o.given_by_user_id, o.created_at, o.comment,
	o.form, o.form_template_version, o.document_hash, o.paper_form_signed, o.not_returned_at, o.not_returned_by_user_id,
	o.not_returned_comment, o.whereabouts, o.returned_date::text, o.returned_at, o.returned_by_user_id, o.return_comment,
	coalesce(e.first_name || ' ' || e.last_name, ''),
	EXISTS (SELECT 1 FROM asset_signed_copies c WHERE c.assignment_id = o.id)`

// recordFrom is an asset with its open assignment and the holder's name.
const recordFrom = ` FROM assets a
	LEFT JOIN asset_assignments o ON o.asset_id = a.id AND o.returned_date IS NULL
	LEFT JOIN employees e ON e.id = o.employee_id`

// live keeps the assets in current accounting.
const live = `a.deleted_at IS NULL AND a.written_off_at IS NULL`

func assetDest(a *Asset) []any {
	return []any{&a.ID, &a.Kind, &a.Category, &a.InventoryNo, &a.Name, &a.SerialNo, &a.SimNo, &a.PhoneNo, &a.Provider, &a.Plan,
		&a.NonReturnValueCents, &a.Currency, &a.ConnectionStatus, &a.ReceivedDate, &a.Comment, &a.WrittenOffAt,
		&a.WrittenOffByUserID, &a.CreatedAt, &a.UpdatedAt, &a.DeletedAt, &a.CreatedByUserID, &a.UpdatedByUserID,
		&a.DeletedByUserID}
}

// nullAssignment scans an assignment that a LEFT JOIN may leave out.
type nullAssignment struct {
	id, assetID, employeeID, givenBy *uuid.UUID
	givenDate, comment, name         *string
	createdAt                        *time.Time
	signed                           *bool
	copied                           bool
	a                                Assignment
}

func (n *nullAssignment) dest() []any {
	return []any{&n.id, &n.assetID, &n.employeeID, &n.givenDate, &n.givenBy, &n.createdAt, &n.comment,
		&n.a.Form, &n.a.FormTemplateVersion, &n.a.DocumentHash, &n.signed, &n.a.NotReturnedAt, &n.a.NotReturnedByUserID,
		&n.a.NotReturnedComment, &n.a.Whereabouts, &n.a.ReturnedDate, &n.a.ReturnedAt, &n.a.ReturnedByUserID, &n.a.ReturnComment,
		&n.name, &n.copied}
}

func (n *nullAssignment) get() *Assignment {
	if n.id == nil {
		return nil
	}
	a := n.a
	a.ID, a.AssetID, a.EmployeeID, a.GivenByUserID = *n.id, *n.assetID, *n.employeeID, *n.givenBy
	a.GivenDate, a.Comment, a.EmployeeName, a.CreatedAt, a.PaperFormSigned = *n.givenDate, *n.comment, *n.name, n.createdAt.UTC(), *n.signed
	a.SignedCopyUploaded = n.copied
	return &a
}

func utc(a *Asset) {
	a.CreatedAt, a.UpdatedAt = a.CreatedAt.UTC(), a.UpdatedAt.UTC()
}

func scanRecord(row pgx.Row) (Record, error) {
	var r Record
	var n nullAssignment
	if err := row.Scan(append(assetDest(&r.Asset), n.dest()...)...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Record{}, ErrNotFound
		}
		return Record{}, err
	}
	utc(&r.Asset)
	r.Open = n.get()
	return r, nil
}

func scanRecords(rows pgx.Rows) ([]Record, error) {
	defer rows.Close()
	out := make([]Record, 0)
	for rows.Next() {
		r, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func scanAssignment(row pgx.Row) (Assignment, error) {
	var n nullAssignment
	if err := row.Scan(n.dest()...); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Assignment{}, ErrNotFound
		}
		return Assignment{}, err
	}
	return *n.get(), nil
}

func (r *PostgresRepository) Create(ctx context.Context, a Asset, bump *Bump, ev audit.Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO assets (id, kind, category, inventory_no, name, serial_no, sim_no, phone_no, provider, plan,
				non_return_value_cents, currency, connection_status, received_date, comment,
				created_at, updated_at, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::date, $15, $16, $17, $18, $19)`,
			a.ID, a.Kind, a.Category, a.InventoryNo, a.Name, a.SerialNo, a.SimNo, a.PhoneNo, a.Provider, a.Plan,
			a.NonReturnValueCents, a.Currency, a.ConnectionStatus, a.ReceivedDate, a.Comment,
			a.CreatedAt, a.UpdatedAt, a.CreatedByUserID, a.UpdatedByUserID); err != nil {
			return err
		}
		if err := useNumber(ctx, tx, a.ID, a.InventoryNo, a.CreatedAt); err != nil {
			return err
		}
		if bump != nil {
			if err := raiseCounter(ctx, tx, *bump); err != nil {
				return err
			}
		}
		return audit.Insert(ctx, tx, ev)
	}))
}

// raiseCounter raises the prefix's counter to at least b.N.
func raiseCounter(ctx context.Context, tx pgx.Tx, b Bump) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO asset_number_counters (prefix, last) VALUES ($1, $2)
		ON CONFLICT (prefix) DO UPDATE SET last = greatest(asset_number_counters.last, excluded.last)`,
		b.Prefix, b.N)
	return err
}

// useNumber records number as asset id's. A number another asset ever used
// is ErrInventoryNoTaken; one the asset itself used before is its again.
func useNumber(ctx context.Context, tx pgx.Tx, id uuid.UUID, number string, at time.Time) error {
	if _, err := tx.Exec(ctx, `INSERT INTO asset_numbers (number, asset_id, created_at) VALUES ($1, $2, $3)
		ON CONFLICT ((upper(number))) DO NOTHING`, number, id, at); err != nil {
		return err
	}
	var owner uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT asset_id FROM asset_numbers WHERE upper(number) = upper($1)`, number).Scan(&owner); err != nil {
		return err
	}
	if owner != id {
		return ErrInventoryNoTaken
	}
	return nil
}

func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Record, error) {
	return scanRecord(r.pool.QueryRow(ctx, `SELECT `+assetColumns+`, `+assignmentColumns+recordFrom+`
		WHERE a.id = $1 AND `+live, id))
}

func (r *PostgresRepository) Assignments(ctx context.Context, assetID uuid.UUID) ([]Assignment, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+assignmentColumns+` FROM asset_assignments o
		JOIN employees e ON e.id = o.employee_id
		WHERE o.asset_id = $1 ORDER BY o.given_date DESC, o.created_at DESC`, assetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Assignment, 0)
	at := map[uuid.UUID]int{}
	for rows.Next() {
		a, err := scanAssignment(rows)
		if err != nil {
			return nil, err
		}
		a.SignedCopies = make([]SignedCopy, 0)
		at[a.ID] = len(out)
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	copies, err := r.pool.Query(ctx, `SELECT `+signedCopyColumns+` FROM asset_signed_copies c
		JOIN asset_assignments o ON o.id = c.assignment_id
		JOIN users u ON u.id = c.uploaded_by_user_id
		WHERE o.asset_id = $1 ORDER BY c.uploaded_at DESC, c.id`, assetID)
	if err != nil {
		return nil, err
	}
	defer copies.Close()
	for copies.Next() {
		c, err := scanSignedCopy(copies)
		if err != nil {
			return nil, err
		}
		if i, ok := at[c.AssignmentID]; ok {
			out[i].SignedCopies = append(out[i].SignedCopies, c)
		}
	}
	return out, copies.Err()
}

const signedCopyColumns = `c.id, c.assignment_id, c.object_key, c.file_name, c.content_type, c.size_bytes, c.sha256,
	c.uploaded_at, c.uploaded_by_user_id, u.name`

func scanSignedCopy(row pgx.Row) (SignedCopy, error) {
	var c SignedCopy
	err := row.Scan(&c.ID, &c.AssignmentID, &c.ObjectKey, &c.FileName, &c.ContentType, &c.SizeBytes, &c.SHA256,
		&c.UploadedAt, &c.UploadedByUserID, &c.UploadedByName)
	if errors.Is(err, pgx.ErrNoRows) {
		return SignedCopy{}, ErrNotFound
	}
	c.UploadedAt = c.UploadedAt.UTC()
	return c, err
}

func (r *PostgresRepository) SignedCopy(ctx context.Context, assetID, assignmentID, copyID uuid.UUID) (SignedCopy, error) {
	return scanSignedCopy(r.pool.QueryRow(ctx, `SELECT `+signedCopyColumns+` FROM asset_signed_copies c
		JOIN asset_assignments o ON o.id = c.assignment_id
		JOIN users u ON u.id = c.uploaded_by_user_id
		WHERE c.id = $1 AND c.assignment_id = $2 AND o.asset_id = $3`, copyID, assignmentID, assetID))
}

func (r *PostgresRepository) AddSignedCopy(ctx context.Context, assetID, assignmentID uuid.UUID, fn SignedCopyFunc) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := lock(ctx, tx, assetID)
		if err != nil {
			return err
		}
		as, err := scanAssignment(tx.QueryRow(ctx, `SELECT `+assignmentColumns+` FROM asset_assignments o
			JOIN employees e ON e.id = o.employee_id
			WHERE o.id = $1 AND o.asset_id = $2`, assignmentID, assetID))
		if errors.Is(err, ErrNotFound) {
			return ErrAssignmentNotFound
		}
		if err != nil {
			return err
		}
		c, ev, err := fn(cur.Asset, as)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO asset_signed_copies (id, assignment_id, object_key, file_name, content_type, size_bytes, sha256,
				uploaded_at, uploaded_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			c.ID, c.AssignmentID, c.ObjectKey, c.FileName, c.ContentType, c.SizeBytes, c.SHA256, c.UploadedAt, c.UploadedByUserID); err != nil {
			return err
		}
		return audit.Insert(ctx, tx, ev)
	}))
}

func (r *PostgresRepository) List(ctx context.Context, f ListFilter) ([]Record, int, error) {
	where := live + ` AND a.kind = $1`
	args := []any{f.Kind}
	add := func(cond string, v any) {
		args = append(args, v)
		where += fmt.Sprintf(" AND "+cond, len(args))
	}
	if f.Q != "" {
		// Numbers match without spaces on either side; names as typed.
		args = append(args, contains(f.Q), contains(compactSIM(f.Q)))
		where += fmt.Sprintf(` AND (replace(coalesce(a.sim_no, ''), ' ', '') ILIKE $%[2]d
			OR replace(coalesce(a.phone_no, ''), ' ', '') ILIKE $%[2]d OR replace(a.inventory_no, ' ', '') ILIKE $%[2]d
			OR coalesce(a.name, '') ILIKE $%[1]d OR coalesce(a.serial_no, '') ILIKE $%[1]d
			OR coalesce(e.first_name || ' ' || e.last_name, '') ILIKE $%[1]d)`, len(args)-1, len(args))
	}
	if f.Location != nil {
		switch *f.Location {
		case LocationOffice:
			where += ` AND o.id IS NULL`
		case LocationWithEmployee:
			where += ` AND o.id IS NOT NULL AND o.whereabouts IS DISTINCT FROM 'UNKNOWN'`
		case LocationUnknown:
			where += ` AND o.whereabouts = 'UNKNOWN'`
		}
	}
	if f.Held {
		where += ` AND o.id IS NOT NULL`
	}
	if f.EmployeeID != nil {
		add(`o.employee_id = $%d`, *f.EmployeeID)
	}
	if f.Provider != "" {
		add(`lower(a.provider) = lower($%d)`, f.Provider)
	}
	if f.Category != nil {
		add(`a.category = $%d`, string(*f.Category))
	}
	if f.Status != nil {
		add(`a.connection_status = $%d`, string(*f.Status))
	}
	if f.NotReturned {
		where += ` AND o.not_returned_at IS NOT NULL`
	}
	if f.SignedCopyMissing {
		where += ` AND o.form IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_signed_copies c WHERE c.assignment_id = o.id)`
	}

	var total int
	if err := r.pool.QueryRow(ctx, `SELECT count(*)`+recordFrom+` WHERE `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := r.pool.Query(ctx, fmt.Sprintf(`SELECT `+assetColumns+`, `+assignmentColumns+recordFrom+` WHERE `+where+`
		ORDER BY `+orderBy(f)+` LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2), append(args, f.Limit, f.Offset)...)
	if err != nil {
		return nil, 0, err
	}
	out, err := scanRecords(rows)
	return out, total, err
}

// orderBy is the register's order; ties fall back to the inventory number.
func orderBy(f ListFilter) string {
	dir := "ASC"
	if f.Desc {
		dir = "DESC"
	}
	tie := `upper(a.inventory_no) ` + dir + `, a.id`
	switch f.Sort {
	case SortStatus:
		return `a.connection_status ` + dir + ` NULLS LAST, ` + tie
	case SortHolder:
		return `lower(e.last_name) ` + dir + ` NULLS LAST, lower(e.first_name) ` + dir + `, ` + tie
	case SortGiven:
		return `o.given_date ` + dir + ` NULLS LAST, ` + tie
	case SortName:
		return `lower(a.name) ` + dir + ` NULLS LAST, ` + tie
	}
	return tie
}

// contains is a case-insensitive LIKE pattern matching q anywhere, literally.
func contains(q string) string {
	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
}

func (r *PostgresRepository) Summary(ctx context.Context, kind Kind) (Summary, error) {
	var s Summary
	err := r.pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE o.id IS NULL), count(o.id),
			count(*) FILTER (WHERE o.not_returned_at IS NOT NULL)`+recordFrom+`
		WHERE `+live+` AND a.kind = $1`, kind).Scan(&s.Total, &s.InOffice, &s.WithEmployees, &s.NotReturned)
	if err != nil {
		return Summary{}, err
	}
	rows, err := r.pool.Query(ctx, `SELECT DISTINCT a.provider FROM assets a
		WHERE `+live+` AND a.kind = $1 AND a.provider IS NOT NULL ORDER BY a.provider`, kind)
	if err != nil {
		return Summary{}, err
	}
	s.Providers, err = pgx.CollectRows(rows, pgx.RowTo[string])
	if s.Providers == nil {
		s.Providers = make([]string, 0)
	}
	return s, err
}

func (r *PostgresRepository) ByNumber(ctx context.Context, q string, limit int) ([]Record, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+assetColumns+`, `+assignmentColumns+recordFrom+`
		WHERE `+live+` AND (replace(coalesce(a.sim_no, ''), ' ', '') ILIKE $1
			OR replace(coalesce(a.phone_no, ''), ' ', '') ILIKE $1 OR replace(a.inventory_no, ' ', '') ILIKE $1)
		ORDER BY upper(a.inventory_no), a.id LIMIT $2`, contains(q), limit)
	if err != nil {
		return nil, err
	}
	return scanRecords(rows)
}

func (r *PostgresRepository) ByEmployee(ctx context.Context, employeeID uuid.UUID) ([]Held, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+assignmentColumns+`, `+assetColumns+` FROM asset_assignments o
		JOIN employees e ON e.id = o.employee_id
		JOIN assets a ON a.id = o.asset_id
		WHERE o.employee_id = $1
		ORDER BY o.returned_date IS NOT NULL, o.given_date DESC, o.created_at DESC`, employeeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Held, 0)
	for rows.Next() {
		var n nullAssignment
		var h Held
		if err := rows.Scan(append(n.dest(), assetDest(&h.Asset)...)...); err != nil {
			return nil, err
		}
		utc(&h.Asset)
		h.Assignment = *n.get()
		out = append(out, h)
	}
	return out, rows.Err()
}

func (r *PostgresRepository) Employee(ctx context.Context, id uuid.UUID) (EmployeeView, error) {
	return readEmployee(ctx, r.pool, id, "")
}

type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func readEmployee(ctx context.Context, q querier, id uuid.UUID, lock string) (EmployeeView, error) {
	var e EmployeeView
	err := q.QueryRow(ctx, `SELECT id, first_name, last_name, code FROM employees
		WHERE id = $1 AND deleted_at IS NULL `+lock, id).Scan(&e.ID, &e.FirstName, &e.LastName, &e.Code)
	if errors.Is(err, pgx.ErrNoRows) {
		return EmployeeView{}, ErrEmployeeNotFound
	}
	return e, err
}

func (r *PostgresRepository) LastNumber(ctx context.Context, prefix string) (int64, error) {
	var last int64
	err := r.pool.QueryRow(ctx, `SELECT last FROM asset_number_counters WHERE prefix = $1`, prefix).Scan(&last)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return last, err
}

func (r *PostgresRepository) NumberOwner(ctx context.Context, number string) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.pool.QueryRow(ctx, `SELECT asset_id FROM asset_numbers WHERE upper(number) = upper($1)`, number).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	return id, err
}

func (r *PostgresRepository) SIMOwner(ctx context.Context, simNo string) (uuid.UUID, error) {
	var id uuid.UUID
	err := r.pool.QueryRow(ctx, `SELECT id FROM assets
		WHERE deleted_at IS NULL AND sim_no IS NOT NULL AND upper(replace(sim_no, ' ', '')) = $1`, compactSIM(simNo)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	return id, err
}

// lock locks the live asset and its open assignment. The asset is locked in a
// statement of its own and read in the next: a statement that waited for the
// lock would see the assignment as it was before the holder committed (only
// the locked row is re-read), so a second Return would find it still open.
func lock(ctx context.Context, tx pgx.Tx, id uuid.UUID) (Record, error) {
	var locked uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT a.id FROM assets a WHERE a.id = $1 AND `+live+` FOR UPDATE`, id).Scan(&locked); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Record{}, ErrNotFound
		}
		return Record{}, err
	}
	r, err := scanRecord(tx.QueryRow(ctx, `SELECT `+assetColumns+`, `+assignmentColumns+recordFrom+`
		WHERE a.id = $1`, id))
	if err != nil {
		return Record{}, err
	}
	if r.Open != nil {
		// The open assignment is locked too: it is the row Return and Mark as
		// Not Returned write.
		if _, err := tx.Exec(ctx, `SELECT 1 FROM asset_assignments WHERE id = $1 FOR UPDATE`, r.Open.ID); err != nil {
			return Record{}, err
		}
	}
	return r, nil
}

func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Record, error) {
	var out Record
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := lock(ctx, tx, id)
		if err != nil {
			return err
		}
		next, evs, err := m(cur.Asset, cur.Open)
		if err != nil {
			return err
		}
		if len(evs) > 0 {
			if err := writeAsset(ctx, tx, cur.Asset, next); err != nil {
				return err
			}
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out = Record{Asset: next, Open: cur.Open}
		return nil
	})
	return out, translate(err)
}

// writeAsset writes next's details over cur's, recording a new inventory
// number as used and, when it is the next prefix's own PREFIX-NNNNNN, raising
// that counter, as Add does (spec, Numbers).
func writeAsset(ctx context.Context, tx pgx.Tx, cur, next Asset) error {
	if !strings.EqualFold(cur.InventoryNo, next.InventoryNo) {
		if err := useNumber(ctx, tx, next.ID, next.InventoryNo, next.UpdatedAt); err != nil {
			return err
		}
		if b := BumpOf(next); b != nil {
			if err := raiseCounter(ctx, tx, *b); err != nil {
				return err
			}
		}
	}
	_, err := tx.Exec(ctx, `
		UPDATE assets SET category = $2, inventory_no = $3, name = $4, serial_no = $5, sim_no = $6, phone_no = $7,
			provider = $8, plan = $9, non_return_value_cents = $10, connection_status = $11, received_date = $12::date,
			comment = $13, updated_at = $14, updated_by_user_id = $15
		WHERE id = $1`,
		next.ID, next.Category, next.InventoryNo, next.Name, next.SerialNo, next.SimNo, next.PhoneNo,
		next.Provider, next.Plan, next.NonReturnValueCents, next.ConnectionStatus, next.ReceivedDate,
		next.Comment, next.UpdatedAt, next.UpdatedByUserID)
	return err
}

func (r *PostgresRepository) Give(ctx context.Context, assetID, employeeID uuid.UUID, fn GiveFunc) (Assignment, error) {
	var out Assignment
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := lock(ctx, tx, assetID)
		if err != nil {
			return err
		}
		// FOR SHARE: the employee cannot be deleted until the assignment
		// commits, and Delete employee, which locks the row, then sees it.
		emp, err := readEmployee(ctx, tx, employeeID, "FOR SHARE")
		if err != nil {
			return err
		}
		next, a, evs, err := fn(cur.Asset, cur.Open, emp)
		if err != nil {
			return err
		}
		if !next.UpdatedAt.Equal(cur.Asset.UpdatedAt) {
			if err := writeAsset(ctx, tx, cur.Asset, next); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO asset_assignments (id, asset_id, employee_id, given_date, given_by_user_id, created_at, comment,
				form, form_template_version, document_hash, paper_form_signed)
			VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11)`,
			a.ID, a.AssetID, a.EmployeeID, a.GivenDate, a.GivenByUserID, a.CreatedAt, a.Comment,
			nullJSON(a.Form), a.FormTemplateVersion, a.DocumentHash, a.PaperFormSigned); err != nil {
			return err
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out = a
		return nil
	})
	return out, translate(err)
}

func (r *PostgresRepository) UpdateOpen(ctx context.Context, assetID uuid.UUID, fn OpenMutation) (Assignment, error) {
	var out Assignment
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := lock(ctx, tx, assetID)
		if err != nil {
			return err
		}
		next, evs, err := fn(cur.Asset, cur.Open)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE asset_assignments SET not_returned_at = $2, not_returned_by_user_id = $3, not_returned_comment = $4,
				whereabouts = $5, returned_date = $6::date, returned_at = $7, returned_by_user_id = $8, return_comment = $9
			WHERE id = $1`,
			next.ID, next.NotReturnedAt, next.NotReturnedByUserID, next.NotReturnedComment, next.Whereabouts,
			next.ReturnedDate, next.ReturnedAt, next.ReturnedByUserID, next.ReturnComment); err != nil {
			return err
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out = next
		return nil
	})
	return out, translate(err)
}

func nullJSON(b []byte) any {
	if b == nil {
		return nil
	}
	return b
}

func (r *PostgresRepository) Record(ctx context.Context, ev audit.Event) error {
	return translate(audit.Insert(ctx, r.pool, ev))
}

func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505":
		switch pgErr.ConstraintName {
		case "assets_sim_no_live_idx":
			return ErrSIMNoTaken
		case "asset_assignments_open_idx":
			return ErrAlreadyGiven
		}
		return ErrInventoryNoTaken
	case "23503":
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
