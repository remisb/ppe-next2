package document

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/remisb/ppe-next2/internal/audit"
)

// The personnel file's other writes: Show Document's reads, a document's
// changes and removal, the retention dates and Legal Hold, and shredding.

// Document reads a live document with its sealed fields, its copies' rows
// and its subject's sealed data key; ErrNotFound when there is none.
func (r *PostgresRepository) Document(ctx context.Context, id uuid.UUID) (Opened, error) {
	var o Opened
	row := r.pool.QueryRow(ctx, `SELECT `+documentColumns+`, d.sealed, k.sealed_key, k.key_id
		FROM personnel.identity_documents d JOIN personnel.subject_keys k ON k.employee_id = d.employee_id
		WHERE d.id = $1 AND d.deleted_at IS NULL`, id)
	var sides []string
	err := row.Scan(&o.Document.ID, &o.Document.EmployeeID, &o.Document.Kind, &o.Document.IssuingState, &o.Document.IssuedOn,
		&o.Document.ExpiresOn, &o.Document.OnEmployeeRecord, &o.Document.SupersededAt, &o.Document.CreatedAt,
		&o.Document.CreatedByUserID, &sides, &o.Sealed, &o.SealedKey, &o.KeyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Opened{}, ErrNotFound
	}
	if err != nil {
		return Opened{}, err
	}
	o.Document.Copies = make([]Side, len(sides))
	for i, s := range sides {
		o.Document.Copies[i] = Side(s)
	}
	o.Document.CreatedAt = o.Document.CreatedAt.UTC()
	rows, err := r.pool.Query(ctx, `SELECT id, side, object_key, sha256, bytes FROM personnel.document_copies
		WHERE document_id = $1 ORDER BY side`, id)
	if err != nil {
		return Opened{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var c Copy
		if err := rows.Scan(&c.ID, &c.Side, &c.ObjectKey, &c.SHA256, &c.Bytes); err != nil {
			return Opened{}, err
		}
		o.Copies = append(o.Copies, c)
	}
	return o, rows.Err()
}

// Record inserts events in a transaction of their own.
func (r *PostgresRepository) Record(ctx context.Context, events []audit.Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		return audit.InsertAll(ctx, tx, events)
	}))
}

// UpdateDocument locks the live document, applies mutate, and writes its
// Add to Employee Record or soft-deletes it, with the events, at the first
// event's time and by its actor; no events, no write.
func (r *PostgresRepository) UpdateDocument(ctx context.Context, id uuid.UUID, mutate func(cur Document) (DocumentChange, []audit.Event, error)) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scanDocument(tx.QueryRow(ctx, `SELECT `+documentColumns+` FROM personnel.identity_documents d
			WHERE d.id = $1 AND d.deleted_at IS NULL FOR UPDATE`, id))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		change, events, err := mutate(cur)
		if err != nil {
			return err
		}
		if len(events) == 0 {
			return nil
		}
		actor := events[0].ActorUserID
		if change.Removed {
			if _, err := tx.Exec(ctx, `UPDATE personnel.identity_documents
				SET deleted_at = $2, deleted_by_user_id = $3, updated_at = $2, updated_by_user_id = $3 WHERE id = $1`,
				id, events[0].OccurredAt, actor); err != nil {
				return err
			}
		} else if _, err := tx.Exec(ctx, `UPDATE personnel.identity_documents
			SET on_employee_record = $2, updated_at = $3, updated_by_user_id = $4 WHERE id = $1`,
			id, change.OnEmployeeRecord, events[0].OccurredAt, actor); err != nil {
			return err
		}
		return audit.InsertAll(ctx, tx, events)
	}))
}

// UpdateSubject locks the subject (ErrNotFound without one), applies mutate
// and writes the retention dates and hold with the events; no events, no write.
func (r *PostgresRepository) UpdateSubject(ctx context.Context, employeeID uuid.UUID, mutate func(cur Retention) (Retention, []audit.Event, error)) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var cur Retention
		err := tx.QueryRow(ctx, `SELECT employment_ended_on::text, hold_until::text, hold_reason
			FROM personnel.subjects WHERE employee_id = $1 FOR UPDATE`, employeeID).
			Scan(&cur.EmploymentEndedOn, &cur.HoldUntil, &cur.HoldReason)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		next, events, err := mutate(cur)
		if err != nil || len(events) == 0 {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE personnel.subjects SET employment_ended_on = $2::text::date,
			hold_until = $3::text::date, hold_reason = $4, updated_at = $5, updated_by_user_id = $6 WHERE employee_id = $1`,
			employeeID, next.EmploymentEndedOn, next.HoldUntil, next.HoldReason, events[0].OccurredAt, events[0].ActorUserID); err != nil {
			return err
		}
		return audit.InsertAll(ctx, tx, events)
	}))
}

// Retention reads the subject's retention; false when they have no file.
func (r *PostgresRepository) Retention(ctx context.Context, employeeID uuid.UUID) (Retention, bool, error) {
	var ret Retention
	err := r.pool.QueryRow(ctx, `SELECT employment_ended_on::text, hold_until::text, hold_reason
		FROM personnel.subjects WHERE employee_id = $1`, employeeID).Scan(&ret.EmploymentEndedOn, &ret.HoldUntil, &ret.HoldReason)
	if errors.Is(err, pgx.ErrNoRows) {
		return Retention{}, false, nil
	}
	return ret, err == nil, err
}

// Due reads the subjects due for shredding by today. A deleted employee
// without an end date counts as ended on the day of their deletion (the UTC
// date), so the employee service needs no call into Personnel files.
func (r *PostgresRepository) Due(ctx context.Context, today string, months int) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, `SELECT s.employee_id FROM personnel.subjects s JOIN employees e ON e.id = s.employee_id
		WHERE coalesce(s.employment_ended_on, (e.deleted_at AT TIME ZONE 'UTC')::date) + make_interval(months => $2) <= $1::text::date
		  AND (s.hold_until IS NULL OR s.hold_until < $1::text::date)
		ORDER BY s.employee_id`, today, months)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// Shred locks the subject, deletes the copies', documents', data key's and
// subject's rows, writes events(documents) and returns the copies' object
// keys; nothing to do when there is no subject.
func (r *PostgresRepository) Shred(ctx context.Context, employeeID uuid.UUID, events func(documents int) []audit.Event) ([]string, error) {
	var keys []string
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		keys = nil
		var found bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT FROM personnel.subjects WHERE employee_id = $1 FOR UPDATE)`, employeeID).Scan(&found); err != nil {
			return err
		}
		if !found {
			return nil
		}
		rows, err := tx.Query(ctx, `DELETE FROM personnel.document_copies c USING personnel.identity_documents d
			WHERE c.document_id = d.id AND d.employee_id = $1 RETURNING c.object_key`, employeeID)
		if err != nil {
			return err
		}
		if keys, err = pgx.CollectRows(rows, pgx.RowTo[string]); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `DELETE FROM personnel.identity_documents WHERE employee_id = $1`, employeeID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM personnel.subject_keys WHERE employee_id = $1`, employeeID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM personnel.subjects WHERE employee_id = $1`, employeeID); err != nil {
			return err
		}
		return audit.InsertAll(ctx, tx, events(int(tag.RowsAffected())))
	})
	return keys, translate(err)
}
