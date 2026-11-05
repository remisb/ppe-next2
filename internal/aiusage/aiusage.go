// Package aiusage records every call the app makes to an AI model (ADR 0007,
// decision 8; docs/specs/ai-usage-service.md): the business operation, the
// model, the tokens it reports, what they cost by the price table in force,
// who and when, and whether it went through. Like internal/usage it is
// infrastructure: every AI call goes through Run, which also refuses one once
// the month's budget is spent. No prompt, image or answer is ever kept.
package aiusage

import (
	"context"
	"errors"
	"math"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Operation is the business action an AI call serves; a fixed list.
type Operation string

// PortraitColorize is Make Colour Photo (AI) on a document's portrait.
const PortraitColorize Operation = "portrait.colorize"

var operations = []Operation{PortraitColorize}

// Operations returns every operation; @ppe/api-client's AI_OPERATIONS lists the same.
func Operations() []Operation { return slices.Clone(operations) }

// Outcome is how a call ended.
type Outcome string

const (
	OK      Outcome = "ok"
	Failed  Outcome = "failed"  // the provider or the network refused; tokens it reported are kept
	Refused Outcome = "refused" // the app refused before calling: budget spent, no key, no prices
)

// Tokens are a call's tokens by kind, as the provider reports them.
type Tokens struct {
	InputText   int `json:"input_text"`
	InputImage  int `json:"input_image"`
	OutputText  int `json:"output_text"`
	OutputImage int `json:"output_image"`
}

// Prices are a model's in USD per million tokens of each kind.
type Prices struct {
	InputText   float64 `json:"input_text"`
	InputImage  float64 `json:"input_image"`
	OutputText  float64 `json:"output_text"`
	OutputImage float64 `json:"output_image"`
}

// Cost is t at these prices, in micro-dollars, rounded up: a dollar per
// million tokens is a micro-dollar a token.
func (p Prices) Cost(t Tokens) int64 {
	c := float64(t.InputText)*p.InputText + float64(t.InputImage)*p.InputImage +
		float64(t.OutputText)*p.OutputText + float64(t.OutputImage)*p.OutputImage
	return int64(math.Ceil(c - 1e-9))
}

// DefaultPrices are OpenAI's list prices when this was written (USD per
// million tokens); Settings → AI changes them when OpenAI does.
var DefaultPrices = map[string]Prices{
	"gpt-image-2": {InputText: 5, InputImage: 8, OutputText: 0, OutputImage: 30},
}

// Call is one AI call, as recorded.
type Call struct {
	ID                uuid.UUID  `json:"id"`
	At                time.Time  `json:"at"`
	Operation         Operation  `json:"operation"`
	Provider          string     `json:"provider"`
	Model             string     `json:"model"`
	Outcome           Outcome    `json:"outcome"`
	ErrorCode         string     `json:"error_code,omitempty"`
	Tokens            Tokens     `json:"tokens"`
	CostMicroUSD      int64      `json:"cost_micro_usd"`
	Prices            Prices     `json:"prices"`
	DurationMS        int        `json:"duration_ms"`
	UserID            uuid.UUID  `json:"user_id"`
	UserName          string     `json:"user_name,omitempty"` // read back with the call, never stored with it
	Source            string     `json:"source"`
	RequestID         string     `json:"request_id"`
	ProviderRequestID string     `json:"provider_request_id,omitempty"`
	EmployeeID        *uuid.UUID `json:"employee_id"`
}

// Store keeps the ledger.
type Store interface {
	Insert(ctx context.Context, c Call) error
	// CostSince is what the calls since from cost, in micro-dollars.
	CostSince(ctx context.Context, from time.Time) (int64, error)
}

var (
	// ErrBudgetSpent refuses a call once the month's AI budget is spent (429).
	ErrBudgetSpent = errors.New("this month's AI budget is spent")
	// ErrNoPrices refuses a call to a model the price table does not price.
	ErrNoPrices = errors.New("the AI model has no prices in Settings")
)

// Request is a call about to be made: what for, to which model, by whom, at
// which prices and under which budget (micro-dollars a month, nil for none).
type Request struct {
	Operation  Operation
	Provider   string
	Model      string
	Prices     *Prices
	Budget     *int64
	UserID     uuid.UUID
	EmployeeID *uuid.UUID
}

// Result is what a call says of itself: its tokens and the provider's request id.
type Result struct {
	Tokens            Tokens
	ProviderRequestID string
}

// ErrorCoder is an error that names itself by a short code for the ledger
// (the provider's error code, "timeout"…), never with what was sent.
type ErrorCoder interface{ ErrorCode() string }

type Service struct {
	store Store
	now   func() time.Time
	newID func() uuid.UUID
	loc   *time.Location
}

type Option func(*Service)

func WithClock(now func() time.Time) Option       { return func(s *Service) { s.now = now } }
func WithIDGenerator(gen func() uuid.UUID) Option { return func(s *Service) { s.newID = gen } }

// WithLocation is the organisation's timezone: the budget's month is its.
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

func NewService(store Store, opts ...Option) *Service {
	s := &Service{store: store, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New, loc: time.UTC}
	for _, o := range opts {
		o(s)
	}
	return s
}

// monthStart is the first instant of now's month in the organisation's timezone.
func (s *Service) monthStart(now time.Time) time.Time {
	l := now.In(s.loc)
	return time.Date(l.Year(), l.Month(), 1, 0, 0, 0, 0, s.loc)
}

// Run makes an AI call through call and records it: refused (nothing
// called) without prices or once the month's cost has reached the budget;
// else ok or failed, with the tokens the call reports either way. Run
// returns call's error, or the refusal's.
func (s *Service) Run(ctx context.Context, r Request, call func(ctx context.Context) (Result, error)) error {
	req := audit.RequestFrom(ctx)
	rec := Call{
		ID: s.newID(), At: s.now(), Operation: r.Operation, Provider: r.Provider, Model: r.Model,
		UserID: r.UserID, Source: string(req.Source), RequestID: req.ID, EmployeeID: r.EmployeeID,
	}
	refuse := func(code string, err error) error {
		rec.Outcome, rec.ErrorCode = Refused, code
		if e := s.store.Insert(context.WithoutCancel(ctx), rec); e != nil {
			return e
		}
		return err
	}
	if r.Prices == nil {
		return refuse("no_prices", ErrNoPrices)
	}
	rec.Prices = *r.Prices
	if r.Budget != nil {
		spent, err := s.store.CostSince(ctx, s.monthStart(rec.At))
		if err != nil {
			return err
		}
		if spent >= *r.Budget {
			return refuse("budget_spent", ErrBudgetSpent)
		}
	}
	res, err := call(ctx)
	rec.DurationMS = int(s.now().Sub(rec.At).Milliseconds())
	rec.Tokens, rec.ProviderRequestID = res.Tokens, res.ProviderRequestID
	rec.CostMicroUSD = rec.Prices.Cost(res.Tokens)
	rec.Outcome = OK
	if err != nil {
		rec.Outcome, rec.ErrorCode = Failed, "error"
		var coded ErrorCoder
		if errors.As(err, &coded) {
			rec.ErrorCode = coded.ErrorCode()
		}
		if errors.Is(err, context.DeadlineExceeded) {
			rec.ErrorCode = "timeout"
		}
	}
	if e := s.store.Insert(context.WithoutCancel(ctx), rec); e != nil && err == nil {
		return e
	}
	return err
}

// SpentThisMonth is what the month's calls cost so far, for Settings and the Overview.
func (s *Service) SpentThisMonth(ctx context.Context) (int64, error) {
	return s.store.CostSince(ctx, s.monthStart(s.now()))
}
