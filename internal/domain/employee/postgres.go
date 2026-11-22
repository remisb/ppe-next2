package employee

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores employees in the employees table (migration
// 0003, with merged_into_id since 0052) and the pairs marked Not the Same
// Person in employee_distinct_pairs (0052), with their audit events. Its
// reads also take each employee's default photo from employee_photos (0037);
// Merge moves rows of orders, asset_assignments and employee_photos.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository is a PostgresRepository over pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// columns are what scan reads, in its order: the employee's own columns, the
// default photo's id, the identity document's fields, and the open
// employment's company and whether there was any employment (the status).
const columns = `id, first_name, last_name, code, height_cm, clothing_size, shoe_size, notes, preferred_language,
	created_at, updated_at, deleted_at, created_by_user_id, updated_by_user_id, deleted_by_user_id,
	(SELECT p.id FROM employee_photos p WHERE p.employee_id = employees.id AND p.is_default AND p.deleted_at IS NULL) AS default_photo_id,
	birth_date::text, nationality, sex,
	(SELECT m.company_id FROM employments m WHERE m.employee_id = employees.id AND m.ended_on IS NULL AND m.deleted_at IS NULL) AS company_id,
	(SELECT c.name FROM employments m JOIN companies c ON c.id = m.company_id
		WHERE m.employee_id = employees.id AND m.ended_on IS NULL AND m.deleted_at IS NULL) AS company_name,
	EXISTS (SELECT 1 FROM employments m WHERE m.employee_id = employees.id AND m.deleted_at IS NULL) AS ever_employed`

// scan reads one row of columns; ErrNotFound when there is none. Times are UTC.
func scan(row pgx.Row) (Employee, error) {
	var e Employee
	var companyID *uuid.UUID
	var companyName *string
	var ever bool
	err := row.Scan(&e.ID, &e.FirstName, &e.LastName, &e.Code, &e.HeightCm, &e.ClothingSize, &e.ShoeSize, &e.Notes, &e.PreferredLanguage,
		&e.CreatedAt, &e.UpdatedAt, &e.DeletedAt, &e.CreatedByUserID, &e.UpdatedByUserID, &e.DeletedByUserID, &e.DefaultPhotoID,
		&e.BirthDate, &e.Nationality, &e.Sex, &companyID, &companyName, &ever)
	if errors.Is(err, pgx.ErrNoRows) {
		return Employee{}, ErrNotFound
	}
	if err != nil {
		return Employee{}, err
	}
	e.CreatedAt, e.UpdatedAt = e.CreatedAt.UTC(), e.UpdatedAt.UTC()
	switch {
	case companyID != nil:
		e.Status, e.Company = StatusEmployee, &CompanyRef{ID: *companyID}
		if companyName != nil {
			e.Company.Name = *companyName
		}
	case ever:
		e.Status = StatusFormer
	default:
		e.Status = StatusCandidate
	}
	return e, nil
}

// scanAll reads every row of columns and closes rows; [] when there are none.
func scanAll(rows pgx.Rows) ([]Employee, error) {
	defer rows.Close()
	out := make([]Employee, 0)
	for rows.Next() {
		e, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// Create inserts e, its employments and evs in one transaction.
func (r *PostgresRepository) Create(ctx context.Context, e Employee, evs []audit.Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `
			INSERT INTO employees (id, first_name, last_name, code, height_cm, clothing_size, shoe_size, notes,
				preferred_language, created_at, updated_at, created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			e.ID, e.FirstName, e.LastName, e.Code, e.HeightCm, e.ClothingSize, e.ShoeSize, e.Notes,
			e.PreferredLanguage, e.CreatedAt, e.UpdatedAt, e.CreatedByUserID, e.UpdatedByUserID); err != nil {
			return err
		}
		for _, m := range e.Employments {
			if err := writeEmployment(ctx, tx, m, nil); err != nil {
				return err
			}
		}
		return audit.InsertAll(ctx, tx, evs)
	}))
}

// jobColumns are an employment's (m) columns as scanJob reads them, with its
// company's name (c).
const jobColumns = `m.id, m.employee_id, m.company_id, c.name, m.started_on::text, m.ended_on::text,
	m.created_at, m.updated_at, m.created_by_user_id, m.updated_by_user_id`

// jobOrder is the employments' order: open first, then newest.
const jobOrder = `ORDER BY m.ended_on IS NULL DESC, m.ended_on DESC, m.started_on DESC NULLS LAST, m.created_at DESC, m.id`

// readJobs reads employee id's live employments in jobOrder.
func readJobs(ctx context.Context, q interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, id uuid.UUID) ([]Employment, error) {
	rows, err := q.Query(ctx, `SELECT `+jobColumns+` FROM employments m JOIN companies c ON c.id = m.company_id
		WHERE m.employee_id = $1 AND m.deleted_at IS NULL `+jobOrder, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Employment, error) {
		var m Employment
		err := row.Scan(&m.ID, &m.EmployeeID, &m.CompanyID, &m.CompanyName, &m.StartedOn, &m.EndedOn,
			&m.CreatedAt, &m.UpdatedAt, &m.CreatedByUserID, &m.UpdatedByUserID)
		m.CreatedAt, m.UpdatedAt = m.CreatedAt.UTC(), m.UpdatedAt.UTC()
		return m, err
	})
}

// Employments reads live employee id's live employments.
func (r *PostgresRepository) Employments(ctx context.Context, id uuid.UUID) ([]Employment, error) {
	return readJobs(ctx, r.pool, id)
}

// writeEmployment inserts m, or updates it when cur (its stored state) is
// given. A new company, or a changed one, must be live: its row is share-locked
// so Delete company cannot pass it.
func writeEmployment(ctx context.Context, tx pgx.Tx, m Employment, cur *Employment) error {
	if cur == nil || cur.CompanyID != m.CompanyID {
		var ok bool
		err := tx.QueryRow(ctx, `SELECT true FROM companies WHERE id = $1 AND deleted_at IS NULL FOR SHARE`, m.CompanyID).Scan(&ok)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCompanyNotFound
		}
		if err != nil {
			return err
		}
	}
	if cur == nil {
		_, err := tx.Exec(ctx, `
			INSERT INTO employments (id, employee_id, company_id, started_on, ended_on, created_at, updated_at,
				created_by_user_id, updated_by_user_id)
			VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9)`,
			m.ID, m.EmployeeID, m.CompanyID, m.StartedOn, m.EndedOn, m.CreatedAt, m.UpdatedAt, m.CreatedByUserID, m.UpdatedByUserID)
		return err
	}
	_, err := tx.Exec(ctx, `
		UPDATE employments SET company_id = $2, started_on = $3::date, ended_on = $4::date, updated_at = $5,
			updated_by_user_id = $6, deleted_at = $7, deleted_by_user_id = $8
		WHERE id = $1`,
		m.ID, m.CompanyID, m.StartedOn, m.EndedOn, m.UpdatedAt, m.UpdatedByUserID, m.DeletedAt, m.DeletedByUserID)
	return err
}

// UpdateEmployments locks live employee id, reads its employments, applies m
// and writes what it returns and its events, then reads the employee back.
func (r *PostgresRepository) UpdateEmployments(ctx context.Context, id uuid.UUID, m EmploymentMutation) (Employee, error) {
	var out Employee
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx,
			`SELECT `+columns+` FROM employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id))
		if err != nil {
			return err
		}
		jobs, err := readJobs(ctx, tx, id)
		if err != nil {
			return err
		}
		writes, evs, err := m(cur, jobs)
		if err != nil {
			return err
		}
		known := make(map[uuid.UUID]*Employment, len(jobs))
		for i := range jobs {
			known[jobs[i].ID] = &jobs[i]
		}
		// Ended and removed periods first, so a move never holds two open ones at once.
		closing := func(w Employment) bool { return !w.Open() || w.DeletedAt != nil }
		for _, first := range []bool{true, false} {
			for _, w := range writes {
				if closing(w) == first {
					w.EmployeeID = id
					if err := writeEmployment(ctx, tx, w, known[w.ID]); err != nil {
						return err
					}
				}
			}
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out, err = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM employees WHERE id = $1`, id))
		return err
	})
	return out, translate(err)
}

// Get reads live employee id.
func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (Employee, error) {
	return scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM employees WHERE id = $1 AND deleted_at IS NULL`, id))
}

// List reads every live employee in name order.
func (r *PostgresRepository) List(ctx context.Context) ([]Employee, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+columns+` FROM employees WHERE deleted_at IS NULL
		ORDER BY lower(last_name), lower(first_name), id`)
	if err != nil {
		return nil, err
	}
	return scanAll(rows)
}

// SearchByName filters live employees by q with LIKE, its wildcards escaped.
func (r *PostgresRepository) SearchByName(ctx context.Context, q string, limit int) ([]Employee, error) {
	pattern := "%" + escapeLike(strings.ToLower(q)) + "%"
	rows, err := r.pool.Query(ctx, `SELECT `+columns+` FROM employees
		WHERE deleted_at IS NULL AND (
			lower(first_name) LIKE $1 OR lower(last_name) LIKE $1
			OR lower(first_name || ' ' || last_name) LIKE $1 OR lower(coalesce(code, '')) LIKE $1)
		ORDER BY lower(last_name), lower(first_name), id
		LIMIT $2`, pattern, limit)
	if err != nil {
		return nil, err
	}
	return scanAll(rows)
}

// Update locks live row id FOR UPDATE, applies m, and writes every mutable
// column and m's events in the same transaction.
func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (Employee, error) {
	var out Employee
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx,
			`SELECT `+columns+` FROM employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id))
		if err != nil {
			return err
		}
		next, evs, err := m(cur)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE employees SET first_name = $2, last_name = $3, code = $4, height_cm = $5,
				clothing_size = $6, shoe_size = $7, notes = $8, preferred_language = $9, updated_at = $10,
				updated_by_user_id = $11, deleted_at = $12, deleted_by_user_id = $13
			WHERE id = $1`,
			id, next.FirstName, next.LastName, next.Code, next.HeightCm, next.ClothingSize, next.ShoeSize,
			next.Notes, next.PreferredLanguage, next.UpdatedAt, next.UpdatedByUserID, next.DeletedAt, next.DeletedByUserID); err != nil {
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

// escapeLike makes q match literally inside a LIKE pattern.
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}

// translate maps Postgres errors to this package's sentinels: a unique
// violation (the live code index) to ErrCodeTaken, a foreign key (the actor
// columns) to ErrActorNotFound and a CHECK to ErrInvalid naming it. Others
// pass as they are.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505":
		if pgErr.ConstraintName == "employments_open_idx" {
			return ErrEmployed
		}
		return ErrCodeTaken
	case "23503":
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
