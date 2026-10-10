package asset

import (
	"context"
	"slices"

	"github.com/google/uuid"
)

// Sight is which assets a reader may see. Everyone sees SIMs; Equipment &
// Furniture, and who holds each item, only a reader whose roles grant
// equipment.read (the Equipment Assignments role). The caller decides it from
// the reader's permissions; the service applies it to every read.
type Sight struct {
	Equipment bool
}

// Sees reports whether the reader may see assets of kind k.
func (s Sight) Sees(k Kind) bool { return k != KindEquipment || s.Equipment }

// Kinds are the kinds the reader may see.
func (s Sight) Kinds() []Kind {
	return slices.DeleteFunc([]Kind{KindSIM, KindEquipment}, func(k Kind) bool { return !s.Sees(k) })
}

// Check is ErrNotPermitted when the reader asks for a kind they may not see:
// the register, its tiles or Add Asset for Equipment & Furniture.
func (s Sight) Check(k Kind) error {
	if !s.Sees(k) {
		return ErrNotPermitted
	}
	return nil
}

// Seen is ErrNotFound for an asset the reader may not see, as for one that
// does not exist, so its number and holder stay hidden. Every route on one
// asset checks it first; an asset's kind never changes.
func (s *Service) Seen(ctx context.Context, id uuid.UUID, see Sight) error {
	r, err := s.repo.Get(ctx, id)
	if err != nil {
		return err
	}
	if !see.Sees(r.Asset.Kind) {
		return ErrNotFound
	}
	return nil
}
