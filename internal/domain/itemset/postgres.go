package itemset

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/audit"
)

// PostgresRepository stores sets in item_sets and item_set_lines (migration 0005).
type PostgresRepository struct {
	pool *pgxpool.Pool
}

var _ Repository = (*PostgresRepository)(nil)

// NewPostgresRepository is the item set repository over pool.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{pool: pool}
}

// columns are the item_sets columns scan reads, in its order.
const columns = `id, name, description, active, created_at, updated_at, deleted_at,
	created_by_user_id, updated_by_user_id, deleted_by_user_id`

// scan reads a set row without its lines (an empty slice), times in UTC; no
// row is ErrNotFound.
func scan(row pgx.Row) (ItemSet, error) {
	var s ItemSet
	err := row.Scan(&s.ID, &s.Name, &s.Description, &s.Active, &s.CreatedAt, &s.UpdatedAt, &s.DeletedAt,
		&s.CreatedByUserID, &s.UpdatedByUserID, &s.DeletedByUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ItemSet{}, ErrNotFound
	}
	if err != nil {
		return ItemSet{}, err
	}
	s.CreatedAt, s.UpdatedAt = s.CreatedAt.UTC(), s.UpdatedAt.UTC()
	s.Lines = make([]Line, 0)
	return s, nil
}

// withLines loads the lines of sets in one query and attaches them in display order.
func (r *PostgresRepository) withLines(ctx context.Context, sets []ItemSet) ([]ItemSet, error) {
	if len(sets) == 0 {
		return sets, nil
	}
	ids := make([]uuid.UUID, len(sets))
	index := make(map[uuid.UUID]int, len(sets))
	for i, s := range sets {
		ids[i], index[s.ID] = s.ID, i
	}
	rows, err := r.pool.Query(ctx, `SELECT item_set_id, catalogue_item_id, default_quantity, display_order
		FROM item_set_lines WHERE item_set_id = ANY($1) ORDER BY item_set_id, display_order`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var setID uuid.UUID
		var l Line
		if err := rows.Scan(&setID, &l.CatalogueItemID, &l.DefaultQuantity, &l.DisplayOrder); err != nil {
			return nil, err
		}
		i := index[setID]
		sets[i].Lines = append(sets[i].Lines, l)
	}
	return sets, rows.Err()
}

// query reads the sets sql selects, with their lines.
func (r *PostgresRepository) query(ctx context.Context, sql string, args ...any) ([]ItemSet, error) {
	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out := make([]ItemSet, 0)
	for rows.Next() {
		s, err := scan(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return r.withLines(ctx, out)
}

// Get reads the live set and its lines, or ErrNotFound.
func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (ItemSet, error) {
	s, err := scan(r.pool.QueryRow(ctx, `SELECT `+columns+` FROM item_sets WHERE id = $1 AND deleted_at IS NULL`, id))
	if err != nil {
		return ItemSet{}, err
	}
	sets, err := r.withLines(ctx, []ItemSet{s})
	if err != nil {
		return ItemSet{}, err
	}
	return sets[0], nil
}

// List reads every live set by name.
func (r *PostgresRepository) List(ctx context.Context) ([]ItemSet, error) {
	return r.query(ctx, `SELECT `+columns+` FROM item_sets WHERE deleted_at IS NULL ORDER BY lower(name), id`)
}

// ListActive reads the live, active sets by name.
func (r *PostgresRepository) ListActive(ctx context.Context) ([]ItemSet, error) {
	return r.query(ctx, `SELECT `+columns+` FROM item_sets WHERE deleted_at IS NULL AND active ORDER BY lower(name), id`)
}

// Create inserts the set, its lines and ev in one transaction.
func (r *PostgresRepository) Create(ctx context.Context, s ItemSet, ev audit.Event) error {
	return translate(pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO item_sets (id, name, description, active, created_at, updated_at,
			created_by_user_id, updated_by_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			s.ID, s.Name, s.Description, s.Active, s.CreatedAt, s.UpdatedAt, s.CreatedByUserID, s.UpdatedByUserID); err != nil {
			return err
		}
		if err := insertLines(ctx, tx, s); err != nil {
			return err
		}
		return audit.Insert(ctx, tx, ev)
	}))
}

// Update locks the live set, reads its lines, applies m, writes the set,
// replaces its lines (unless m deleted it) and inserts the events.
func (r *PostgresRepository) Update(ctx context.Context, id uuid.UUID, m Mutation) (ItemSet, error) {
	var out ItemSet
	err := pgx.BeginFunc(ctx, r.pool, func(tx pgx.Tx) error {
		cur, err := scan(tx.QueryRow(ctx, `SELECT `+columns+` FROM item_sets WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, id))
		if err != nil {
			return err
		}
		if cur.Lines, err = readLines(ctx, tx, id); err != nil {
			return err
		}
		next, evs, err := m(cur)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE item_sets SET name = $2, description = $3, active = $4,
			updated_at = $5, updated_by_user_id = $6, deleted_at = $7, deleted_by_user_id = $8 WHERE id = $1`,
			id, next.Name, next.Description, next.Active, next.UpdatedAt, next.UpdatedByUserID, next.DeletedAt, next.DeletedByUserID); err != nil {
			return err
		}
		if !next.Deleted() {
			if _, err := tx.Exec(ctx, `DELETE FROM item_set_lines WHERE item_set_id = $1`, id); err != nil {
				return err
			}
			if err := insertLines(ctx, tx, next); err != nil {
				return err
			}
		}
		if err := audit.InsertAll(ctx, tx, evs); err != nil {
			return err
		}
		out = next
		return nil
	})
	return out, translate(err)
}

// readLines reads set id's lines in display order inside tx.
func readLines(ctx context.Context, tx pgx.Tx, id uuid.UUID) ([]Line, error) {
	rows, err := tx.Query(ctx, `SELECT catalogue_item_id, default_quantity, display_order
		FROM item_set_lines WHERE item_set_id = $1 ORDER BY display_order`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Line, error) {
		var l Line
		err := row.Scan(&l.CatalogueItemID, &l.DefaultQuantity, &l.DisplayOrder)
		return l, err
	})
}

// insertLines inserts s's lines.
func insertLines(ctx context.Context, tx pgx.Tx, s ItemSet) error {
	for _, l := range s.Lines {
		if _, err := tx.Exec(ctx, `INSERT INTO item_set_lines (item_set_id, catalogue_item_id, default_quantity, display_order)
			VALUES ($1, $2, $3, $4)`, s.ID, l.CatalogueItemID, l.DefaultQuantity, l.DisplayOrder); err != nil {
			return err
		}
	}
	return nil
}

// translate maps Postgres errors to sentinels: a unique violation is the
// name (ErrNameTaken), a line's item foreign key ErrUnknownItem, any other
// foreign key the actor (ErrActorNotFound), a CHECK ErrInvalid naming the
// constraint.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err
	}
	switch pgErr.Code {
	case "23505":
		return ErrNameTaken
	case "23503":
		if pgErr.ConstraintName == "item_set_lines_catalogue_item_id_fkey" {
			return ErrUnknownItem
		}
		return ErrActorNotFound
	case "23514":
		return fmt.Errorf("%w: %s", ErrInvalid, pgErr.ConstraintName)
	}
	return err
}
