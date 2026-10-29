package asset

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Scan SIMs (docs/specs/asset-service.md "Scan SIM cards" and "PIN and PUK",
// ADR 0005): newly received SIM cards added in a batch, each with the PIN and
// PUK printed on its carrier, kept sealed.
const (
	// Showing a card's PIN and PUK changes nothing, but who saw them is
	// recorded. Neither event ever holds the codes.
	EventSIMCodesShown   = "asset.sim_codes_shown"
	EventSIMCodesChanged = "asset.sim_codes_changed"
	// MaxScannedSIMs is the most cards one batch adds.
	MaxScannedSIMs = 100
	// sealKeyID names API_SIM_CODES_KEY on each sealed row, so a later key
	// can be brought in beside it.
	sealKeyID int16 = 1
)

var (
	// iccidPattern is a scanned SIM No.: an ICCID of 19 digits, from 89
	// (telecommunications), with the filler F of the 20-character form.
	iccidPattern = regexp.MustCompile(`^89[0-9]{17}F?$`)
	pinPattern   = regexp.MustCompile(`^[0-9]{4,8}$`)
	pukPattern   = regexp.MustCompile(`^[0-9]{8}$`)
)

// Sealer seals a card's codes for its id and opens them again
// (internal/sealbox). Without one, codes are neither kept nor shown.
type Sealer interface {
	Seal(plain, context []byte) ([]byte, error)
	Open(sealed, context []byte) ([]byte, error)
}

// WithSealer keeps PIN and PUK, sealed by sealer.
func WithSealer(sealer Sealer) Option { return func(s *Service) { s.sealer = sealer } }

// SIMCodes are a SIM card's PIN and PUK, as printed on its carrier.
type SIMCodes struct {
	PIN string
	PUK string
}

// SealedCodes are a card's codes as kept: sealed together for the card.
type SealedCodes struct {
	AssetID         uuid.UUID
	Sealed          []byte
	KeyID           int16
	UpdatedAt       time.Time
	UpdatedByUserID uuid.UUID
}

// ScannedSIM is one card of a batch: its SIM No. and, when its back was
// read, its PIN and PUK (both, or neither).
type ScannedSIM struct {
	SimNo string
	PIN   string
	PUK   string
}

// AddSIMsParams are a batch of newly received SIM cards: what they share,
// chosen once (the apps fill it in from Settings), and the cards.
type AddSIMsParams struct {
	Provider            *string
	Plan                *string
	NonReturnValueCents *int64
	ReceivedDate        *string
	Comment             string
	Cards               []ScannedSIM
}

// ProblemCode is what is wrong with a card of a batch; the apps word it.
type ProblemCode string

const (
	ProblemNotSIMNo        ProblemCode = "not_sim_no"       // not 89 and 17 more digits, with an optional F
	ProblemCheckDigit      ProblemCode = "check_digit"      // its last digit does not check (Luhn)
	ProblemDuplicate       ProblemCode = "duplicate"        // another card of the batch has it
	ProblemRegistered      ProblemCode = "registered"       // a SIM card in the register has it
	ProblemCodesIncomplete ProblemCode = "codes_incomplete" // a PIN without its PUK, or the other way round
	ProblemPIN             ProblemCode = "pin"              // not 4 to 8 digits
	ProblemPUK             ProblemCode = "puk"              // not 8 digits
)

// SIMProblem is one problem of one card, by its index in the batch.
type SIMProblem struct {
	Index      int
	Field      string // sim_no, pin or puk
	Code       ProblemCode
	ExistingID *uuid.UUID // the card in the register, for ProblemRegistered
	Other      *int       // the batch's other card, for ProblemDuplicate
}

// AddedSIM is one card a batch added.
type AddedSIM struct {
	ID          uuid.UUID
	InventoryNo string
	SimNo       string
}

// validSIMNo is whether a scanned SIM No. is an ICCID whose check digit, its
// 19th, checks (Luhn); the filler F is not a digit of it.
func validSIMNo(simNo string) bool {
	return iccidPattern.MatchString(simNo) && luhn(strings.TrimSuffix(simNo, "F"))
}

// luhn is whether digits end in their Luhn check digit.
func luhn(digits string) bool {
	sum := 0
	for i := range len(digits) {
		d := int(digits[len(digits)-1-i] - '0')
		if i%2 == 1 {
			if d *= 2; d > 9 {
				d -= 9
			}
		}
		sum += d
	}
	return sum%10 == 0
}

// normalize compacts the SIM No. (no spaces, capitals) and trims the codes.
func (c ScannedSIM) normalize() ScannedSIM {
	return ScannedSIM{SimNo: compactSIM(strings.TrimSpace(c.SimNo)), PIN: strings.TrimSpace(c.PIN), PUK: strings.TrimSpace(c.PUK)}
}

// codes are the card's PIN and PUK, nil when it has neither.
func (c ScannedSIM) codes() *SIMCodes {
	if c.PIN == "" && c.PUK == "" {
		return nil
	}
	return &SIMCodes{PIN: c.PIN, PUK: c.PUK}
}

// problems are what is wrong with the card on its own. A problem never
// quotes a code: the codes are secrets, and errors reach logs.
func (c ScannedSIM) problems(i int) []SIMProblem {
	var out []SIMProblem
	switch {
	case !iccidPattern.MatchString(c.SimNo):
		out = append(out, SIMProblem{Index: i, Field: "sim_no", Code: ProblemNotSIMNo})
	case !validSIMNo(c.SimNo):
		out = append(out, SIMProblem{Index: i, Field: "sim_no", Code: ProblemCheckDigit})
	}
	switch {
	case (c.PIN == "") != (c.PUK == ""):
		field := "pin"
		if c.PUK == "" {
			field = "puk"
		}
		out = append(out, SIMProblem{Index: i, Field: field, Code: ProblemCodesIncomplete})
	case c.PIN != "":
		if !pinPattern.MatchString(c.PIN) {
			out = append(out, SIMProblem{Index: i, Field: "pin", Code: ProblemPIN})
		}
		if !pukPattern.MatchString(c.PUK) {
			out = append(out, SIMProblem{Index: i, Field: "puk", Code: ProblemPUK})
		}
	}
	return out
}

// Validate checks the codes Set PIN and PUK keeps.
func (c SIMCodes) Validate() error {
	switch {
	case !pinPattern.MatchString(c.PIN):
		return fieldError("pin", "must be 4 to 8 digits")
	case !pukPattern.MatchString(c.PUK):
		return fieldError("puk", "must be 8 digits")
	}
	return nil
}

// checkBatch checks what the cards share, as Add SIM checks it, and that
// there are cards, at most MaxScannedSIMs.
func (s *Service) checkBatch(p *AddSIMsParams) error {
	p.Provider, p.Plan, p.ReceivedDate = blankToNil(p.Provider), blankToNil(p.Plan), blankToNil(p.ReceivedDate)
	p.Comment = strings.TrimSpace(p.Comment)
	switch {
	case len(p.Cards) == 0:
		return fieldError("cards", "are required")
	case len(p.Cards) > MaxScannedSIMs:
		return fieldError("cards", fmt.Sprintf("may be at most %d at a time", MaxScannedSIMs))
	case p.Provider == nil:
		return fieldError("provider", "is required")
	case len(*p.Provider) > maxTextLen:
		return fieldError("provider", "is too long")
	case p.Plan != nil && len(*p.Plan) > maxTextLen:
		return fieldError("plan", "is too long")
	case p.NonReturnValueCents != nil && (*p.NonReturnValueCents < 0 || *p.NonReturnValueCents > maxValueCents):
		return fieldError("non_return_value_cents", "is out of range")
	case len(p.Comment) > maxCommentLen:
		return fieldError("comment", "is too long")
	}
	if p.ReceivedDate != nil {
		if err := s.checkDate("received_date", *p.ReceivedDate); err != nil {
			return err
		}
	}
	for i := range p.Cards {
		p.Cards[i] = p.Cards[i].normalize()
	}
	return nil
}

// CheckSIMs is every problem of a batch's cards, in one answer, so the
// review list marks them all: each card on its own, the batch's duplicates
// and the cards already in the register. What the cards share is checked
// first; a problem there is the error.
func (s *Service) CheckSIMs(ctx context.Context, p AddSIMsParams) ([]SIMProblem, error) {
	if err := s.checkBatch(&p); err != nil {
		return nil, err
	}
	out := make([]SIMProblem, 0)
	seen := map[string]int{}
	keys := make([]string, 0, len(p.Cards))
	for i, c := range p.Cards {
		out = append(out, c.problems(i)...)
		if c.SimNo == "" {
			continue
		}
		k := simKey(c.SimNo)
		if j, ok := seen[k]; ok {
			out = append(out, SIMProblem{Index: i, Field: "sim_no", Code: ProblemDuplicate, Other: &j})
			continue
		}
		seen[k] = i
		keys = append(keys, k)
	}
	owners, err := s.repo.SIMOwners(ctx, keys)
	if err != nil {
		return nil, err
	}
	for i, c := range p.Cards {
		if id, ok := owners[simKey(c.SimNo)]; ok && seen[simKey(c.SimNo)] == i {
			out = append(out, SIMProblem{Index: i, Field: "sim_no", Code: ProblemRegistered, ExistingID: &id})
		}
	}
	return out, nil
}

// AddSIMs is Scan SIMs' Add: the batch's cards registered all or none, in one
// transaction, each Not Activated in the Office, numbered on from the SIM
// counter, with what the batch shares and its sealed PIN and PUK. Each card
// records asset.registered, as Add SIM does. A card's problem is an
// *ImportRowError with its index; one in the register, a DuplicateError
// inside it.
func (s *Service) AddSIMs(ctx context.Context, p AddSIMsParams, actor uuid.UUID) ([]AddedSIM, error) {
	if actor == uuid.Nil {
		return nil, fieldError("actor", "is required")
	}
	if err := s.checkBatch(&p); err != nil {
		return nil, err
	}
	sims := make([]ImportSIM, len(p.Cards))
	for i, c := range p.Cards {
		if pr := c.problems(i); len(pr) > 0 {
			return nil, &ImportRowError{Index: i, Err: fieldError(pr[0].Field, problemText(pr[0].Code))}
		}
		simNo := c.SimNo
		sims[i] = ImportSIM{
			Params: Params{
				SimNo: &simNo, Provider: p.Provider, Plan: p.Plan, NonReturnValueCents: p.NonReturnValueCents,
				ReceivedDate: p.ReceivedDate, Comment: p.Comment,
			},
			Status: StatusNotActivated,
			Codes:  c.codes(),
		}
	}
	items, registered, err := s.registerSIMs(ctx, sims, "", actor)
	if err != nil {
		return nil, err
	}
	if err := s.writeSIMs(ctx, items, true); err != nil {
		return nil, err
	}
	out := make([]AddedSIM, len(registered))
	for i, r := range registered {
		out[i] = AddedSIM{ID: r.ID, InventoryNo: r.InventoryNo, SimNo: r.SimNo}
	}
	return out, nil
}

// problemText is a card's problem as an error says it, never quoting a code.
func problemText(c ProblemCode) string {
	switch c {
	case ProblemNotSIMNo:
		return "must be 89 and 17 more digits, with an optional F"
	case ProblemCheckDigit:
		return "has a last digit that does not check, so it was misread or mistyped"
	case ProblemCodesIncomplete:
		return "is needed with the other code"
	case ProblemPIN:
		return "must be 4 to 8 digits"
	case ProblemPUK:
		return "must be 8 digits"
	}
	return string(c)
}

// codesContext binds a card's sealed codes to its id.
func codesContext(id uuid.UUID) []byte { return []byte("ppe.asset_sim_codes.v1|" + id.String()) }

// seal is c sealed for the card id, written by actor at now.
func (s *Service) seal(id uuid.UUID, c SIMCodes, actor uuid.UUID, now time.Time) (SealedCodes, error) {
	if s.sealer == nil {
		return SealedCodes{}, ErrSIMCodesUnavailable
	}
	sealed, err := s.sealer.Seal([]byte(c.PIN+" "+c.PUK), codesContext(id))
	if err != nil {
		return SealedCodes{}, err
	}
	return SealedCodes{AssetID: id, Sealed: sealed, KeyID: sealKeyID, UpdatedAt: now, UpdatedByUserID: actor}, nil
}

// simCard is the live SIM card id: codes belong to SIM cards only.
func (s *Service) simCard(ctx context.Context, id uuid.UUID) (Asset, error) {
	r, err := s.repo.Get(ctx, id)
	if err != nil {
		return Asset{}, err
	}
	if r.Asset.Kind != KindSIM {
		return Asset{}, fieldError("kind", "must be SIM: only SIM cards have a PIN and PUK")
	}
	return r.Asset, nil
}

// ShowSIMCodes is Show PIN and PUK: the card's codes, opened, once who asked
// is recorded (asset.sim_codes_shown, without the codes). A card without
// them is ErrNoSIMCodes, and nothing is recorded.
func (s *Service) ShowSIMCodes(ctx context.Context, id uuid.UUID, actor uuid.UUID) (SIMCodes, error) {
	if actor == uuid.Nil {
		return SIMCodes{}, fieldError("actor", "is required")
	}
	if s.sealer == nil {
		return SIMCodes{}, ErrSIMCodesUnavailable
	}
	a, err := s.simCard(ctx, id)
	if err != nil {
		return SIMCodes{}, err
	}
	sc, err := s.repo.SIMCodes(ctx, id)
	if err != nil {
		return SIMCodes{}, err
	}
	plain, err := s.sealer.Open(sc.Sealed, codesContext(id))
	if err != nil {
		return SIMCodes{}, fmt.Errorf("asset: the PIN and PUK of %s do not open (key %d): %w", id, sc.KeyID, err)
	}
	pin, puk, ok := strings.Cut(string(plain), " ")
	if !ok {
		return SIMCodes{}, fmt.Errorf("asset: the PIN and PUK of %s are not as sealed", id)
	}
	ev, err := s.event(actor, EventSIMCodesShown, id, s.now(), nil, map[string]any{"sim_no": a.SimNo})
	if err != nil {
		return SIMCodes{}, err
	}
	if err := s.repo.Record(ctx, ev); err != nil {
		return SIMCodes{}, err
	}
	return SIMCodes{PIN: pin, PUK: puk}, nil
}

// SetSIMCodes keeps a SIM card's PIN and PUK, sealed, in place of any it had
// (asset.sim_codes_changed {"sim_codes": "set"}, without the codes).
func (s *Service) SetSIMCodes(ctx context.Context, id uuid.UUID, c SIMCodes, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	c = SIMCodes{PIN: strings.TrimSpace(c.PIN), PUK: strings.TrimSpace(c.PUK)}
	if err := c.Validate(); err != nil {
		return err
	}
	if _, err := s.simCard(ctx, id); err != nil {
		return err
	}
	now := s.now()
	sc, err := s.seal(id, c, actor, now)
	if err != nil {
		return err
	}
	ev, err := s.event(actor, EventSIMCodesChanged, id, now, nil, map[string]any{"sim_codes": "set"})
	if err != nil {
		return err
	}
	return s.repo.PutSIMCodes(ctx, sc, ev)
}

// ClearSIMCodes forgets a SIM card's PIN and PUK; a card without them is
// ErrNoSIMCodes, and nothing is recorded.
func (s *Service) ClearSIMCodes(ctx context.Context, id uuid.UUID, actor uuid.UUID) error {
	if actor == uuid.Nil {
		return fieldError("actor", "is required")
	}
	if _, err := s.simCard(ctx, id); err != nil {
		return err
	}
	ev, err := s.event(actor, EventSIMCodesChanged, id, s.now(), nil, map[string]any{"sim_codes": "cleared"})
	if err != nil {
		return err
	}
	return s.repo.DeleteSIMCodes(ctx, id, ev)
}
