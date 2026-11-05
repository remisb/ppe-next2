package asset

import (
	"context"
	"slices"

	"github.com/google/uuid"
)

// Sight is which assets a reader may see: SIM cards with sim_cards.read;
// Equipment & Furniture, and who holds each item, only with equipment.read
// (the Equipment Assignments role). The caller decides it from the reader's
// permissions; the service applies it to every read.
type Sight struct {
	SIM       bool
	Equipment bool
}

// Sees reports whether the reader may see assets of kind k. A kind that does
// not exist is left to validation.
func (s Sight) Sees(k Kind) bool {
	switch k {
	case KindSIM:
		return s.SIM
	case KindEquipment:
		return s.Equipment
	}
	return true
}

// Kinds are the kinds the reader may see.
func (s Sight) Kinds() []Kind {
	return slices.DeleteFunc([]Kind{KindSIM, KindEquipment}, func(k Kind) bool { return !s.Sees(k) })
}

// Check is ErrNotPermitted (Equipment & Furniture) or ErrSIMsNotPermitted
// when the reader asks for a kind they may not see: the register, its tiles
// or Add Asset.
func (s Sight) Check(k Kind) error {
	switch {
	case s.Sees(k):
		return nil
	case k == KindSIM:
		return ErrSIMsNotPermitted
	default:
		return ErrNotPermitted
	}
}

// Seen is ErrNotFound for an asset the reader may not see, as for one that
// does not exist, so its number and holder stay hidden. Every route on one
// asset checks it first; an asset's kind never changes.
func (s *Service) Seen(ctx context.Context, id uuid.UUID, see Sight) error {
	_, err := s.seenKind(ctx, id, see)
	return err
}

func (s *Service) seenKind(ctx context.Context, id uuid.UUID, see Sight) (Kind, error) {
	r, err := s.repo.Get(ctx, id)
	if err != nil {
		return "", err
	}
	if !see.Sees(r.Asset.Kind) {
		return "", ErrNotFound
	}
	return r.Asset.Kind, nil
}

// Rights is which assets a writer may change: SIM cards with
// sim_cards.manage, Equipment & Furniture with assets.manage. Like Sight, the
// caller decides it from the writer's permissions.
type Rights struct {
	SIM       bool
	Equipment bool
}

// Check is ErrMayNotChange when the writer may not change assets of kind k.
// A kind that does not exist is left to validation.
func (m Rights) Check(k Kind) error {
	if (k == KindSIM && !m.SIM) || (k == KindEquipment && !m.Equipment) {
		return ErrMayNotChange
	}
	return nil
}

// Changeable is ErrNotFound for an asset the writer may not see, and
// ErrMayNotChange for one they see but may not change. Every write on one
// asset checks it first.
func (s *Service) Changeable(ctx context.Context, id uuid.UUID, see Sight, may Rights) error {
	k, err := s.seenKind(ctx, id, see)
	if err != nil {
		return err
	}
	return may.Check(k)
}
