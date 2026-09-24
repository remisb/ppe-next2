// Package audit writes the append-only audit trail (migration 0002). It is
// infrastructure, not a domain service: services decide what to record and
// build the Event; repositories call Insert inside the same SQL transaction as
// the change, so an event exists exactly when its change committed.
package audit

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

// Event is one audit row. Before and After are JSON snapshots of the changed
// fields; either may be nil (creation has no before).
type Event struct {
	ID          uuid.UUID
	ActorUserID *uuid.UUID // nil only for public, token-authorised actions
	Event       string     // e.g. "catalogue.price_changed"
	EntityType  string     // e.g. "catalogue_item"
	EntityID    uuid.UUID
	OccurredAt  time.Time
	Before      json.RawMessage
	After       json.RawMessage
}

// New builds an Event, marshalling before and after. Pass nil for an absent side.
func New(id uuid.UUID, actor *uuid.UUID, event, entityType string, entityID uuid.UUID, at time.Time, before, after any) (Event, error) {
	b, err := marshal(before)
	if err != nil {
		return Event{}, fmt.Errorf("audit before: %w", err)
	}
	a, err := marshal(after)
	if err != nil {
		return Event{}, fmt.Errorf("audit after: %w", err)
	}
	return Event{
		ID: id, ActorUserID: actor, Event: event, EntityType: entityType,
		EntityID: entityID, OccurredAt: at, Before: b, After: a,
	}, nil
}

func marshal(v any) (json.RawMessage, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}

// Execer is satisfied by pgx.Tx, *pgxpool.Pool and *pgx.Conn.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Insert writes ev. Call it with the transaction that makes the audited change.
func Insert(ctx context.Context, db Execer, ev Event) error {
	_, err := db.Exec(ctx, `
		INSERT INTO audit_events (id, actor_user_id, event, entity_type, entity_id, occurred_at, before, after)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		ev.ID, ev.ActorUserID, ev.Event, ev.EntityType, ev.EntityID, ev.OccurredAt, nullJSON(ev.Before), nullJSON(ev.After))
	return err
}

// nullJSON keeps an absent side as SQL NULL rather than the JSON literal null.
func nullJSON(b json.RawMessage) any {
	if b == nil {
		return nil
	}
	return []byte(b)
}
