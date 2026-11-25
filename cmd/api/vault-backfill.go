package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/remisb/ppe-next2/internal/files"
)

// vaultBackfill is -vault-backfill (docs/specs/vault-service.md, "Signed
// copies"): it checks that every signed copy migration 0065 moved is in the
// vault with its id, object key, size and hash, and that each signed form's
// file is in the store with that hash; it counts the copies not moved yet (the
// previous release wrote them while this one deployed) and, with commit,
// moves them through the migration's own function, which also queues their
// reading. Nothing changes without commit.
func vaultBackfill(ctx context.Context, pool *pgxpool.Pool, store files.Store, commit bool, out io.Writer) error {
	var waiting, differ int
	if err := pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM asset_signed_copies c WHERE NOT EXISTS (SELECT 1 FROM vault.versions v WHERE v.id = c.id)),
		(SELECT count(*) FROM asset_signed_copies c JOIN vault.files f ON f.id = c.id
		 WHERE f.object_key <> c.object_key OR f.sha256 <> c.sha256 OR f.size_bytes <> c.size_bytes)`).Scan(&waiting, &differ); err != nil {
		return err
	}
	if differ > 0 {
		return fmt.Errorf("%d signed copies differ from their file in the vault (object key, size or hash); nothing was moved", differ)
	}
	switch {
	case waiting == 0:
		fmt.Fprintln(out, "every signed copy is in the vault")
	case commit:
		var moved int64
		if err := pool.QueryRow(ctx, `SELECT vault.move_signed_copies()`).Scan(&moved); err != nil {
			return err
		}
		fmt.Fprintf(out, "%d signed copies moved into the vault, their reading queued\n", moved)
	default:
		fmt.Fprintf(out, "%d signed copies are not in the vault yet: run again with -commit to move them\n", waiting)
	}
	if store == nil {
		fmt.Fprintln(out, "no file storage (API_FILES_TARGET): the files were not checked")
		return nil
	}
	rows, err := pool.Query(ctx, `SELECT f.id, f.object_key, f.sha256 FROM vault.files f
		JOIN vault.versions v ON v.id = f.version_id
		JOIN vault.documents d ON d.id = v.document_id
		WHERE d.type = 'asset.signed_form' ORDER BY f.created_at, f.id`)
	if err != nil {
		return err
	}
	type file struct {
		ID     string
		Key    string
		SHA256 string
	}
	all, err := pgx.CollectRows(rows, pgx.RowToStructByPos[file])
	if err != nil {
		return err
	}
	var bad []error
	for _, f := range all {
		if err := checkStored(ctx, store, f.Key, f.SHA256); err != nil {
			bad = append(bad, fmt.Errorf("file %s: %w", f.ID, err))
		}
	}
	fmt.Fprintf(out, "%d signed form files checked in %s, %d missing or changed\n", len(all), store, len(bad))
	return errors.Join(bad...)
}

// archiveBackfill is -vault-backfill's second part (phase 6): it counts the
// stored assignment forms and given orders that have no archived document yet
// (all of them before this release) and, with commit, queues their archiving
// for the worker. Nothing changes without commit.
func archiveBackfill(ctx context.Context, svc services, commit bool, out io.Writer) error {
	sw, err := sweepArchives(ctx, svc, time.Time{}, commit)
	if err != nil {
		return err
	}
	switch {
	case sw.Forms == 0 && sw.Records == 0:
		fmt.Fprintln(out, "every stored assignment form and given order is archived")
	case commit:
		fmt.Fprintf(out, "%d assignment forms and %d Items Given Records queued for archiving by the worker\n", sw.Forms, sw.Records)
	default:
		fmt.Fprintf(out, "%d assignment forms and %d Items Given Records are not archived yet: run again with -commit to queue them\n",
			sw.Forms, sw.Records)
	}
	return nil
}

// checkStored reads key from store and compares its SHA-256 with want.
func checkStored(ctx context.Context, store files.Store, key, want string) error {
	r, err := store.Get(ctx, key)
	if err != nil {
		return err
	}
	defer r.Close()
	h := sha256.New()
	if _, err := io.Copy(h, r); err != nil {
		return err
	}
	if hex.EncodeToString(h.Sum(nil)) != want {
		return errors.New("its bytes do not match the hash taken when it was uploaded")
	}
	return nil
}
