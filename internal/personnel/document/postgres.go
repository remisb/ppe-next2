package document

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository keeps identity documents in the personnel schema
// (migration 0048: subjects, subject_keys, identity_documents,
// document_copies) and writes the employee's row in employees.
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository is the identity documents' repository over pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// The unique indexes whose violation is a duplicate, by name.
const (
	numberLiveIndex     = "identity_documents_number_live_idx"
	personalIndexUnique = "subjects_personal_index_key"
)

// DocumentByNumber reads the live document with the number's index and state.
func (r *PostgresRepository) DocumentByNumber(ctx context.Context, numberIndex []byte, issuingState string) (Ref, bool, error) {
	var ref Ref
	err := r.pool.QueryRow(ctx, `SELECT employee_id, id FROM personnel.identity_documents
		WHERE number_index = $1 AND issuing_state = $2 AND deleted_at IS NULL`, numberIndex, issuingState).
		Scan(&ref.EmployeeID, &ref.DocumentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Ref{}, false, nil
	}
	return ref, err == nil, err
}

// SubjectByPersonalCode reads the employee whose personal code has the index.
func (r *PostgresRepository) SubjectByPersonalCode(ctx context.Context, personalIndex []byte) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := r.pool.QueryRow(ctx, `SELECT employee_id FROM personnel.subjects WHERE personal_index = $1`, personalIndex).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	return id, err == nil, err
}

// Subject reads the employee's subject with their sealed data key.
func (r *PostgresRepository) Subject(ctx context.Context, employeeID uuid.UUID) (Subject, bool, error) {
	s := Subject{EmployeeID: employeeID}
	err := r.pool.QueryRow(ctx, `SELECT s.personal_index, k.sealed_key, k.key_id
		FROM personnel.subjects s JOIN personnel.subject_keys k ON k.employee_id = s.employee_id
		WHERE s.employee_id = $1`, employeeID).Scan(&s.PersonalIndex, &s.SealedKey, &s.KeyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Subject{}, false, nil
	}
	return s, err == nil, err
}

// PossibleDuplicates reads up to five live employees with the same first and
// last name, or the same last name and birth date, ignoring case.
func (r *PostgresRepository) PossibleDuplicates(ctx context.Context, firstName, lastName string, birthDate *string) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, `SELECT id FROM employees
		WHERE deleted_at IS NULL AND (
			(lower(first_name) = lower($1) AND lower(last_name) = lower($2))
			OR ($3::text IS NOT NULL AND birth_date = $3::text::date AND lower(last_name) = lower($2)))
		ORDER BY lower(last_name), lower(first_name), id LIMIT 5`, firstName, lastName, birthDate)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if ids == nil {
		ids = []uuid.UUID{}
	}
	return ids, err
}

// documentColumns are a document's (d) as scanDocument reads them, with its
// copies' sides.
const documentColumns = `d.id, d.employee_id, d.kind, d.issuing_state, d.issued_on::text, d.expires_on::text,
	d.on_employee_record, d.superseded_at, d.created_at, d.created_by_user_id,
	coalesce((SELECT array_agg(c.side ORDER BY c.side) FROM personnel.document_copies c WHERE c.document_id = d.id), '{}')`

// scanDocument reads a row of documentColumns, times in UTC.
func scanDocument(row pgx.Row) (Document, error) {
	var d Document
	var sides []string
	err := row.Scan(&d.ID, &d.EmployeeID, &d.Kind, &d.IssuingState, &d.IssuedOn, &d.ExpiresOn,
		&d.OnEmployeeRecord, &d.SupersededAt, &d.CreatedAt, &d.CreatedByUserID, &sides)
	if err != nil {
		return Document{}, err
	}
	d.Copies = make([]Side, len(sides))
	for i, s := range sides {
		d.Copies[i] = Side(s)
	}
	d.CreatedAt = d.CreatedAt.UTC()
	if d.SupersededAt != nil {
		t := d.SupersededAt.UTC()
		d.SupersededAt = &t
	}
	return d, nil
}

// Documents reads the employee's live documents, current ones first, then newest first.
func (r *PostgresRepository) Documents(ctx context.Context, employeeID uuid.UUID) ([]Document, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+documentColumns+` FROM personnel.identity_documents d
		WHERE d.employee_id = $1 AND d.deleted_at IS NULL
		ORDER BY d.superseded_at IS NOT NULL, d.created_at DESC, d.id`, employeeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Document, 0)
	for rows.Next() {
		d, err := scanDocument(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// Save writes a document in one transaction: the employee created or locked,
// the subject created or locked, the earlier documents of the same kind
// superseded, the document and its copies' rows, the employee's changes and
// the events, Mutate deciding them under the locks.
func (r *PostgresRepository) Save(ctx context.Context, rec SaveRecord) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		doc := rec.Document
		now := doc.CreatedAt
		actor := doc.CreatedByUserID

		var cur EmployeeRecord
		if e := rec.NewEmployee; e != nil {
			if _, err := tx.Exec(ctx, `
				INSERT INTO employees (id, first_name, last_name, code, notes, created_at, updated_at, created_by_user_id, updated_by_user_id)
				VALUES ($1, $2, $3, $4, '', $5, $5, $6, $6)`, e.ID, e.FirstName, e.LastName, e.Code, now, actor); err != nil {
				return err
			}
			cur = *e
		} else {
			cur.ID = rec.EmployeeID
			err := tx.QueryRow(ctx, `SELECT first_name, last_name, code, birth_date::text, nationality, sex
				FROM employees WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, rec.EmployeeID).
				Scan(&cur.FirstName, &cur.LastName, &cur.Code, &cur.BirthDate, &cur.Nationality, &cur.Sex)
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrEmployeeNotFound
			}
			if err != nil {
				return err
			}
		}

		if s := rec.NewSubject; s != nil {
			if _, err := tx.Exec(ctx, `INSERT INTO personnel.subjects (employee_id, personal_index, created_at, updated_at, updated_by_user_id)
				VALUES ($1, $2, $3, $3, $4)`, s.EmployeeID, s.PersonalIndex, now, actor); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO personnel.subject_keys (employee_id, sealed_key, key_id, created_at)
				VALUES ($1, $2, $3, $4)`, s.EmployeeID, s.SealedKey, s.KeyID, now); err != nil {
				return err
			}
		} else {
			tag, err := tx.Exec(ctx, `UPDATE personnel.subjects
				SET personal_index = coalesce(personal_index, $2), updated_at = $3, updated_by_user_id = $4
				WHERE employee_id = $1`, rec.EmployeeID, rec.PersonalIndex, now, actor)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return ErrNotFound
			}
		}

		// The person's live documents of this kind, which this one supersedes.
		rows, err := tx.Query(ctx, `SELECT `+documentColumns+` FROM personnel.identity_documents d
			WHERE d.employee_id = $1 AND d.kind = $2 AND d.deleted_at IS NULL AND d.superseded_at IS NULL
			ORDER BY d.created_at FOR UPDATE`, doc.EmployeeID, doc.Kind)
		if err != nil {
			return err
		}
		var superseded []Document
		for rows.Next() {
			d, err := scanDocument(rows)
			if err != nil {
				rows.Close()
				return err
			}
			superseded = append(superseded, d)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}

		next, events, err := rec.Mutate(cur, superseded)
		if err != nil {
			return err
		}
		if rec.NewEmployee == nil && employeeChanged(cur, next) {
			if _, err := tx.Exec(ctx, `UPDATE employees SET first_name = $2, last_name = $3,
				birth_date = $4::text::date, nationality = $5, sex = $6, updated_at = $7, updated_by_user_id = $8
				WHERE id = $1`, next.ID, next.FirstName, next.LastName, next.BirthDate, next.Nationality, next.Sex, now, actor); err != nil {
				return err
			}
		} else if rec.NewEmployee != nil && (next.BirthDate != nil || next.Nationality != nil || next.Sex != nil) {
			if _, err := tx.Exec(ctx, `UPDATE employees SET birth_date = $2::text::date, nationality = $3, sex = $4 WHERE id = $1`,
				next.ID, next.BirthDate, next.Nationality, next.Sex); err != nil {
				return err
			}
		}
		for _, old := range superseded {
			if _, err := tx.Exec(ctx, `UPDATE personnel.identity_documents SET superseded_at = $2, updated_at = $2, updated_by_user_id = $3
				WHERE id = $1`, old.ID, now, actor); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO personnel.identity_documents
			(id, employee_id, kind, issuing_state, issued_on, expires_on, on_employee_record, sealed, number_index,
			 created_at, created_by_user_id, updated_at, updated_by_user_id)
			VALUES ($1, $2, $3, $4, $5::text::date, $6::text::date, $7, $8, $9, $10, $11, $10, $11)`,
			doc.ID, doc.EmployeeID, doc.Kind, doc.IssuingState, doc.IssuedOn, doc.ExpiresOn, doc.OnEmployeeRecord,
			rec.Sealed, rec.NumberIndex, now, actor); err != nil {
			return err
		}
		for _, c := range rec.Copies {
			if _, err := tx.Exec(ctx, `INSERT INTO personnel.document_copies
				(id, document_id, side, object_key, sha256, bytes, created_at, created_by_user_id)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, c.ID, doc.ID, c.Side, c.ObjectKey, c.SHA256, c.Bytes, now, actor); err != nil {
				return err
			}
		}
		return audit.InsertAll(ctx, tx, events)
	}))
}

// translate maps storage errors to the package's: a duplicate number or
// personal code (a save that raced another), an employee code in use, a
// missing actor.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505": // unique_violation
		switch pgErr.ConstraintName {
		case numberLiveIndex:
			return &DuplicateError{What: duplicateDocument}
		case personalIndexUnique:
			return &DuplicateError{What: duplicateOtherEmployee}
		}
		return ErrEmployeeCodeTaken
	case "23503": // foreign_key_violation: an actor column names no user
		return ErrActorNotFound
	case "23514": // check_violation: the service validates first, so this is a bug
		return fieldErrorConstraint(pgErr.ConstraintName)
	}
	return err
}

// fieldErrorConstraint is ErrInvalid naming the constraint broken, never the value.
func fieldErrorConstraint(name string) error { return fieldError("value", "breaks "+name) }

// employeeChanged is whether a Save changes the employee's row.
func employeeChanged(cur, next EmployeeRecord) bool {
	return cur.FirstName != next.FirstName || cur.LastName != next.LastName ||
		!eq(cur.BirthDate, next.BirthDate) || !eq(cur.Nationality, next.Nationality) || !eq(cur.Sex, next.Sex)
}
