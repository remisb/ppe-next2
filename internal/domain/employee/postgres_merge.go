package employee

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Duplicates and merging (migration 0052): the code lookup a 409 names,
// employee_distinct_pairs, and Merge Employees across employees, orders,
// asset_assignments, employee_photos, employments and the Document Vault's links.

// IDByCode reads the live employee with code, compared as the unique index
// does (lower); false when there is none.
func (r *PostgresRepository) IDByCode(ctx context.Context, code string) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := r.pool.QueryRow(ctx, `SELECT id FROM employees
		WHERE lower(code) = lower($1) AND deleted_at IS NULL`, code).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	return id, err == nil, err
}

// DistinctPairs reads every row of employee_distinct_pairs, which keeps each
// pair smaller id first, as pairKey does.
func (r *PostgresRepository) DistinctPairs(ctx context.Context) (map[[2]uuid.UUID]bool, error) {
	rows, err := r.pool.Query(ctx, `SELECT employee_a, employee_b FROM employee_distinct_pairs`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[[2]uuid.UUID]bool{}
	for rows.Next() {
		var k [2]uuid.UUID
		if err := rows.Scan(&k[0], &k[1]); err != nil {
			return nil, err
		}
		out[k] = true
	}
	return out, rows.Err()
}

// MarkDistinct checks both employees are live, inserts the pair and, only when
// the row is new, writes evs, all in one transaction.
func (r *PostgresRepository) MarkDistinct(ctx context.Context, a, b, actor uuid.UUID, at time.Time, evs []audit.Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var live int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM employees WHERE id = ANY($1) AND deleted_at IS NULL`,
			[]uuid.UUID{a, b}).Scan(&live); err != nil {
			return err
		}
		if live != 2 {
			return ErrNotFound
		}
		tag, err := tx.Exec(ctx, `INSERT INTO employee_distinct_pairs (employee_a, employee_b, marked_by_user_id, marked_at)
			VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, a, b, actor, at)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		return audit.InsertAll(ctx, tx, evs)
	}))
}

// querier is a pool or a transaction.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// readPair reads live keep and remove, locked FOR UPDATE (in id order, so
// two merges of one pair cannot deadlock) when lock is set.
func readPair(ctx context.Context, q querier, keepID, removeID uuid.UUID, lock bool) (Employee, Employee, error) {
	sql := `SELECT ` + columns + ` FROM employees WHERE id = ANY($1) AND deleted_at IS NULL ORDER BY id`
	if lock {
		sql += ` FOR UPDATE`
	}
	rows, err := q.Query(ctx, sql, []uuid.UUID{keepID, removeID})
	if err != nil {
		return Employee{}, Employee{}, err
	}
	es, err := scanAll(rows)
	if err != nil {
		return Employee{}, Employee{}, err
	}
	var keep, remove Employee
	for _, e := range es {
		switch e.ID {
		case keepID:
			keep = e
		case removeID:
			remove = e
		}
	}
	if keep.ID == uuid.Nil || remove.ID == uuid.Nil {
		return Employee{}, Employee{}, ErrNotFound
	}
	return keep, remove, nil
}

// contentsOf reads what moves from removeID to keepID (its orders, deleted
// ones too, its assignments, open and returned, and its live photos, each
// oldest first), how many of the assignments are open, and whether either
// record has identity documents (personnel.subjects), its live employments,
// and whether both are employed now.
func contentsOf(ctx context.Context, q querier, keepID, removeID uuid.UUID) (MergeContents, error) {
	c := MergeContents{}
	ids := func(sql string) ([]uuid.UUID, error) {
		rows, err := q.Query(ctx, sql, removeID)
		if err != nil {
			return nil, err
		}
		out := make([]uuid.UUID, 0)
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			out = append(out, id)
		}
		return out, rows.Err()
	}
	var err error
	// Deleted orders move too: they are the person's, should one be restored.
	if c.Orders, err = ids(`SELECT id FROM orders WHERE employee_id = $1 ORDER BY ordered_at, id`); err != nil {
		return c, err
	}
	if c.Assignments, err = ids(`SELECT id FROM asset_assignments WHERE employee_id = $1 ORDER BY given_date, id`); err != nil {
		return c, err
	}
	if c.Photos, err = ids(`SELECT id FROM employee_photos WHERE employee_id = $1 AND deleted_at IS NULL ORDER BY uploaded_at, id`); err != nil {
		return c, err
	}
	if c.Employments, err = ids(`SELECT id FROM employments WHERE employee_id = $1 AND deleted_at IS NULL
			ORDER BY started_on NULLS FIRST, created_at, id`); err != nil {
		return c, err
	}
	err = q.QueryRow(ctx, `SELECT
			(SELECT count(*) FROM asset_assignments WHERE employee_id = $2 AND returned_date IS NULL),
			EXISTS (SELECT FROM personnel.subjects WHERE employee_id = $1),
			EXISTS (SELECT FROM personnel.subjects WHERE employee_id = $2),
			EXISTS (SELECT FROM employments WHERE employee_id = $1 AND ended_on IS NULL AND deleted_at IS NULL)
				AND EXISTS (SELECT FROM employments WHERE employee_id = $2 AND ended_on IS NULL AND deleted_at IS NULL)`, keepID, removeID).
		Scan(&c.OpenAssignments, &c.KeepHasDocuments, &c.RemoveHasDocuments, &c.BothEmployed)
	return c, err
}

// MergeContents reads both records and what would move, unlocked, for the
// review.
func (r *PostgresRepository) MergeContents(ctx context.Context, keepID, removeID uuid.UUID) (Employee, Employee, MergeContents, error) {
	keep, remove, err := readPair(ctx, r.pool, keepID, removeID, false)
	if err != nil {
		return Employee{}, Employee{}, MergeContents{}, err
	}
	c, err := contentsOf(ctx, r.pool, keepID, removeID)
	return keep, remove, c, err
}

// Merge is Merge Employees' one transaction: both rows locked in id order,
// m applied to them and what moves, then the record removed soft-deleted with
// merged_into_id, its orders, assignments (under ppe.employee_merge, which
// asset_assignments_guard requires) and photos moved, its Not the Same Person
// marks deleted, the record kept written and the events inserted. It answers
// with the record kept as stored.
func (r *PostgresRepository) Merge(ctx context.Context, keepID, removeID uuid.UUID, m MergeMutation) (Employee, error) {
	var out Employee
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		keep, remove, err := readPair(ctx, tx, keepID, removeID, true)
		if err != nil {
			return err
		}
		c, err := contentsOf(ctx, tx, keepID, removeID)
		if err != nil {
			return err
		}
		next, evs, err := m(keep, remove, c)
		if err != nil {
			return err
		}
		// The removed record goes first, so the one kept may take its code.
		if _, err := tx.Exec(ctx, `UPDATE employees SET deleted_at = $2, deleted_by_user_id = $3, merged_into_id = $4,
				updated_at = $2, updated_by_user_id = $3
			WHERE id = $1`, removeID, next.UpdatedAt, next.UpdatedByUserID, keepID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE employees SET merged_into_id = $2 WHERE merged_into_id = $1`, removeID, keepID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET employee_id = $2 WHERE employee_id = $1`, removeID, keepID); err != nil {
			return err
		}
		// Every period moves, removed ones too (Merge refuses two open ones).
		if _, err := tx.Exec(ctx, `UPDATE employments SET employee_id = $2 WHERE employee_id = $1`, removeID, keepID); err != nil {
			return err
		}
		// asset_assignments_guard lets whose an assignment is change only here (migration 0052).
		if _, err := tx.Exec(ctx, `SET LOCAL ppe.employee_merge = on`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE asset_assignments SET employee_id = $2 WHERE employee_id = $1`, removeID, keepID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `SET LOCAL ppe.employee_merge = off`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE employee_photos SET employee_id = $2, is_default = is_default AND NOT $3
			WHERE employee_id = $1`, removeID, keepID, keep.DefaultPhotoID != nil); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM employee_distinct_pairs WHERE employee_a = $1 OR employee_b = $1`, removeID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE employees SET first_name = $2, last_name = $3, code = $4, height_cm = $5,
				clothing_size = $6, shoe_size = $7, notes = $8, preferred_language = $9, updated_at = $10,
				updated_by_user_id = $11
			WHERE id = $1`,
			keepID, next.FirstName, next.LastName, next.Code, next.HeightCm, next.ClothingSize, next.ShoeSize,
			next.Notes, next.PreferredLanguage, next.UpdatedAt, next.UpdatedByUserID); err != nil {
			return err
		}
		if err := moveDocumentLinks(ctx, tx, keepID, removeID, next.FullName()); err != nil {
			return err
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out, err = scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM employees WHERE id = $1`, keepID))
		return err
	})
	return out, translate(err)
}

// moveDocumentLinks gives the Document Vault's links to the removed record to
// the one kept (ADR 0008; a document linked to both keeps one link), names
// them as the kept record is called, and rebuilds those documents' search.
// The vault's schema is the shared kernel's consumer, so its foreign key to
// employees is moved here, in the merge's transaction.
func moveDocumentLinks(ctx context.Context, tx pgx.Tx, keepID, removeID uuid.UUID, name string) error {
	if _, err := tx.Exec(ctx, `DELETE FROM vault.links r WHERE r.subject_kind = 'employee' AND r.subject_id = $1
		AND EXISTS (SELECT 1 FROM vault.links k WHERE k.document_id = r.document_id AND k.subject_kind = 'employee'
			AND k.subject_id = $2)`, removeID, keepID); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `UPDATE vault.links SET subject_id = $2, employee_id = $2, label = $3
		WHERE subject_kind = 'employee' AND subject_id IN ($1, $2) RETURNING document_id`, removeID, keepID, name)
	if err != nil {
		return err
	}
	docs, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return err
	}
	for _, id := range docs {
		if _, err := tx.Exec(ctx, `SELECT vault.refresh_search($1)`, id); err != nil {
			return err
		}
	}
	return nil
}

// MergedInto reads merged_into_id of id, deleted or not; false when id is
// missing or was not merged.
func (r *PostgresRepository) MergedInto(ctx context.Context, id uuid.UUID) (uuid.UUID, bool, error) {
	var into *uuid.UUID
	err := r.pool.QueryRow(ctx, `SELECT merged_into_id FROM employees WHERE id = $1`, id).Scan(&into)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && into == nil) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, err
	}
	return *into, true, nil
}

// MergedFrom reads the ids of the records whose merged_into_id is id, in id
// order; [] when there are none.
func (r *PostgresRepository) MergedFrom(ctx context.Context, id uuid.UUID) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, `SELECT id FROM employees WHERE merged_into_id = $1 ORDER BY id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]uuid.UUID, 0)
	for rows.Next() {
		var x uuid.UUID
		if err := rows.Scan(&x); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}
