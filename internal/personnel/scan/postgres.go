package scan

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository keeps kept scans in personnel.scans (migrations 0053, 0056).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository is the kept scans' repository over pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

const scanColumns = `id, created_by_user_id, created_at, expires_at, object_key, bytes, sha256,
	sealed_key, key_id, sealed_meta, pages, state, document_id, employee_id`

func scanRecord(row pgx.Row) (Record, error) {
	var r Record
	err := row.Scan(&r.ID, &r.CreatedBy, &r.CreatedAt, &r.ExpiresAt, &r.ObjectKey, &r.Bytes, &r.SHA256,
		&r.SealedKey, &r.KeyID, &r.SealedMeta, &r.Pages, &r.State, &r.DocumentID, &r.EmployeeID)
	r.CreatedAt, r.ExpiresAt = r.CreatedAt.UTC(), r.ExpiresAt.UTC()
	return r, err
}

// Insert writes the scan's row and its events in one transaction, first
// deleting the scan it replaces (its maker's, live, not saved) with that one's events.
func (r *PostgresRepository) Insert(ctx context.Context, rec Record, events []audit.Event, replaces uuid.UUID,
	replaced func(Record) ([]audit.Event, error)) (Record, error) {
	var old Record
	err := translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if replaces != uuid.Nil {
			var err error
			old, err = scanRecord(tx.QueryRow(ctx, `DELETE FROM personnel.scans
				WHERE id = $1 AND created_by_user_id = $2 AND expires_at > $3 AND state <> 'saved' RETURNING `+scanColumns,
				replaces, rec.CreatedBy, rec.CreatedAt))
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrNotFound
			}
			if err != nil {
				return err
			}
			evs, err := replaced(old)
			if err != nil {
				return err
			}
			events = append(evs, events...)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO personnel.scans (`+scanColumns+`)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, NULL)`,
			rec.ID, rec.CreatedBy, rec.CreatedAt, rec.ExpiresAt, rec.ObjectKey, rec.Bytes, rec.SHA256,
			rec.SealedKey, rec.KeyID, rec.SealedMeta, rec.Pages, rec.State); err != nil {
			return err
		}
		return audit.InsertAll(ctx, tx, events)
	}))
	return old, err
}

// Live reads owner's scans not expired at now, newest first.
func (r *PostgresRepository) Live(ctx context.Context, owner uuid.UUID, now time.Time) ([]Record, error) {
	rows, err := r.pool.Query(ctx, `SELECT `+scanColumns+` FROM personnel.scans
		WHERE created_by_user_id = $1 AND expires_at > $2 ORDER BY created_at DESC, id`, owner, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Record{}
	for rows.Next() {
		rec, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// Get reads owner's scan by id, not expired at now.
func (r *PostgresRepository) Get(ctx context.Context, id, owner uuid.UUID, now time.Time) (Record, error) {
	rec, err := scanRecord(r.pool.QueryRow(ctx, `SELECT `+scanColumns+` FROM personnel.scans
		WHERE id = $1 AND created_by_user_id = $2 AND expires_at > $3`, id, owner, now))
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	return rec, err
}

// Record writes events alone.
func (r *PostgresRepository) Record(ctx context.Context, events []audit.Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		return audit.InsertAll(ctx, tx, events)
	}))
}

// Delete deletes owner's live scan by id, with the events, in one transaction.
func (r *PostgresRepository) Delete(ctx context.Context, id, owner uuid.UUID, now time.Time,
	events func(Record) ([]audit.Event, error)) (Record, error) {
	var rec Record
	err := translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		var err error
		rec, err = scanRecord(tx.QueryRow(ctx, `DELETE FROM personnel.scans
			WHERE id = $1 AND created_by_user_id = $2 AND expires_at > $3 RETURNING `+scanColumns, id, owner, now))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		evs, err := events(rec)
		if err != nil {
			return err
		}
		return audit.InsertAll(ctx, tx, evs)
	}))
	if err != nil {
		return Record{}, err
	}
	return rec, nil
}

// DeleteExpired deletes every scan expired at now, returning their object keys.
func (r *PostgresRepository) DeleteExpired(ctx context.Context, now time.Time) ([]string, error) {
	rows, err := r.pool.Query(ctx, `DELETE FROM personnel.scans WHERE expires_at <= $1 RETURNING object_key`, now)
	if err != nil {
		return nil, err
	}
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	return keys, nil
}

// translate maps storage errors to the package's sentinels.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23503": // foreign_key_violation: the actor names no user
		return ErrActorNotFound
	case "23514": // check_violation: the service validates first, so this is a bug
		return fieldError("value", "breaks "+pgErr.ConstraintName)
	}
	return err
}
