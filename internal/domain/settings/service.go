package settings

import (
	"context"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

const (
	EventSupplierChatChanged       = "settings.supplier_chat_changed"
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

// UpdateDefaultSIMProvider sets, changes or (empty) clears the provider Add
// SIM Card fills in, recording settings.default_sim_provider_changed when it differs.
func (s *Service) UpdateDefaultSIMProvider(ctx context.Context, provider string, actor uuid.UUID) (Settings, error) {
	if actor == uuid.Nil {
		return Settings{}, fieldError("actor", "is required")
	}
	provider = NormalizeProvider(provider)
	if err := validateProvider(provider); err != nil {
		return Settings{}, err
	}
	return s.repo.Update(ctx, func(cur Settings) (Settings, *audit.Event, error) {
		if provider == cur.DefaultSIMProvider {
			return cur, nil, nil
		}
		now := s.now()
		next := cur
		next.DefaultSIMProvider, next.UpdatedAt, next.UpdatedByUserID = provider, now, actor
		type value struct {
			Provider string `json:"provider"`
		}
		ev, err := audit.New(s.newID(), &actor, EventDefaultSIMProviderChanged, auditEntity, AuditEntityID, now,
			value{cur.DefaultSIMProvider}, value{provider})
		if err != nil {
			return Settings{}, nil, err
		}
		return next, &ev, nil
	})
}
