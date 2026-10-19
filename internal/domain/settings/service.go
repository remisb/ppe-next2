package settings

import (
	"context"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

const (
	EventSupplierChatChanged = "settings.supplier_chat_changed"
	EventSIMProvidersChanged = "settings.sim_providers_changed"
	// EventDefaultSIMProviderChanged was recorded when Add SIM set the default
	// provider (migration 0031) and is no longer written; the audit log still
	// reads the events from then.
	EventDefaultSIMProviderChanged = "settings.default_sim_provider_changed"
	auditEntity                    = "settings"
)

// AuditEntityID names the organisation's settings in audit events: there is
// one set, so it is a fixed id rather than a row's.
var AuditEntityID = uuid.NewSHA1(uuid.NameSpaceURL, []byte("https://workwear.gavort.nl/settings"))

type Service struct {
	repo  Repository
	now   func() time.Time
	newID func() uuid.UUID
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
	for _, o := range opts {
		o(s)
	}
	return s
}

func (s *Service) Get(ctx context.Context) (Settings, error) { return s.repo.Get(ctx) }

// UpdateSupplierChat sets, changes or (both fields empty) clears the
// supplier's WhatsApp group, recording settings.supplier_chat_changed when it differs.
func (s *Service) UpdateSupplierChat(ctx context.Context, p SupplierChatParams, actor uuid.UUID) (Settings, error) {
	if actor == uuid.Nil {
		return Settings{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Settings{}, err
	}
	return s.repo.Update(ctx, func(cur Settings) (Settings, *audit.Event, error) {
		chat := SupplierChat{Name: p.Name, Link: p.Link}
		if chat == cur.SupplierChat {
			return cur, nil, nil
		}
		now := s.now()
		next := cur
		next.SupplierChat, next.UpdatedAt, next.UpdatedByUserID = chat, now, actor
		ev, err := audit.New(s.newID(), &actor, EventSupplierChatChanged, auditEntity, AuditEntityID, now, cur.SupplierChat, chat)
		if err != nil {
			return Settings{}, nil, err
		}
		return next, &ev, nil
	})
}

// UpdateSIMProviders replaces the SIM providers and the default one,
// recording settings.sim_providers_changed when either differs. Cards already
// registered keep their provider, listed or not.
func (s *Service) UpdateSIMProviders(ctx context.Context, p SIMProvidersParams, actor uuid.UUID) (Settings, error) {
	if actor == uuid.Nil {
		return Settings{}, fieldError("actor", "is required")
	}
	if err := p.Validate(); err != nil {
		return Settings{}, err
	}
	return s.repo.Update(ctx, func(cur Settings) (Settings, *audit.Event, error) {
		if slices.Equal(p.Providers, cur.SIMProviders) && p.Default == cur.DefaultSIMProvider {
			return cur, nil, nil
		}
		now := s.now()
		next := cur
		next.SIMProviders, next.DefaultSIMProvider, next.UpdatedAt, next.UpdatedByUserID = p.Providers, p.Default, now, actor
		type value struct {
			Providers []string `json:"providers"`
			Default   string   `json:"default_provider"`
		}
		ev, err := audit.New(s.newID(), &actor, EventSIMProvidersChanged, auditEntity, AuditEntityID, now,
			value{orEmpty(cur.SIMProviders), cur.DefaultSIMProvider}, value{p.Providers, p.Default})
		if err != nil {
			return Settings{}, nil, err
		}
		return next, &ev, nil
	})
}

// orEmpty keeps a list that was never set from reading as null in the event.
func orEmpty(list []string) []string {
	if list == nil {
		return []string{}
	}
	return list
}
