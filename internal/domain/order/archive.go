package order

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Archiver keeps a copy of each given order's Items Given Record in the
// Document Vault (ADR 0008 decision 10, phase 6; docs/specs/vault-service.md,
// "Archiving"), adapted in cmd/api/wire_vault.go. A confirmation tells it once
// its transaction has committed and the order became GIVEN; it only queues the
// copy and never fails or changes the confirmation, and the upkeep's sweep
// (GivenSince) finds what it missed.
type Archiver interface {
	RecordGiven(ctx context.Context, orderID uuid.UUID)
}

// WithArchiver sets where given records are archived. Without it nothing is.
func WithArchiver(a Archiver) Option { return func(s *Service) { s.archiver = a } }

// archive tells the archiver that order id was given.
func (s *Service) archive(ctx context.Context, id uuid.UUID) {
	if s.archiver != nil {
		s.archiver.RecordGiven(context.WithoutCancel(ctx), id)
	}
}

// GivenSince are the live orders given at or after since (the zero time:
// all), oldest first.
func (s *Service) GivenSince(ctx context.Context, since time.Time) ([]uuid.UUID, error) {
	return s.repo.GivenSince(ctx, since)
}
