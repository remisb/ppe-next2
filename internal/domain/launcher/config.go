package launcher

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Config is what the host application tells the registry about itself (ADR
// 0009): its permissions, languages, the groups tiles sit under and the
// pictures its launcher draws. The registry knows no host's catalogue.
type Config struct {
	// Permissions is the host's permission catalogue, in its order. A tile's
	// audience keeps only these, in this order and without duplicates, so
	// equal sets compare and store identically.
	Permissions []string
	// Preview is the permission that shows apps in testing (POC, In
	// development) and the channels testers see.
	Preview string
	// Languages are the languages every tile is named in, the first the default.
	Languages []string
	// Groups are the headings a tile may sit under.
	Groups []Group
	// Icons are the pictures a tile may show; the host's launcher draws each.
	Icons []string
}

// IsKnown reports whether key is one of the host's permissions.
func (c Config) IsKnown(key string) bool { return slices.Contains(c.Permissions, key) }

// Known keeps the keys that are host permissions, in catalogue order, once each.
func (c Config) Known(keys []string) []string {
	out := make([]string, 0, len(keys))
	for _, p := range c.Permissions {
		if slices.Contains(keys, p) {
			out = append(out, p)
		}
	}
	return out
}

// Event is one change the registry records, as the host's audit trail takes
// it: before and after are JSON snapshots of the changed fields, either nil.
// ActorUserID is nil for the registry's own changes (EnsureDefaults, pruning).
type Event struct {
	ID          uuid.UUID
	ActorUserID *uuid.UUID
	Event       string
	EntityType  string
	EntityID    uuid.UUID
	OccurredAt  time.Time
	Before      json.RawMessage
	After       json.RawMessage
}

// Auditor records events in the transaction that makes the change, so a
// change and its record are written together or not at all.
type Auditor interface {
	Record(ctx context.Context, tx pgx.Tx, evs []Event) error
}

// UserNames returns the names of these users, for Manage apps' feedback; a
// missing id has no name.
type UserNames func(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error)

// newEvent builds an Event, marshalling before and after; nil stays absent.
func newEvent(id uuid.UUID, actor *uuid.UUID, event, entityType string, entityID uuid.UUID, at time.Time, before, after any) (Event, error) {
	b, err := marshal(before)
	if err != nil {
		return Event{}, fmt.Errorf("event before: %w", err)
	}
	a, err := marshal(after)
	if err != nil {
		return Event{}, fmt.Errorf("event after: %w", err)
	}
	return Event{ID: id, ActorUserID: actor, Event: event, EntityType: entityType, EntityID: entityID, OccurredAt: at, Before: b, After: a}, nil
}

// marshal is v as JSON, or nil for nil.
func marshal(v any) (json.RawMessage, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}
