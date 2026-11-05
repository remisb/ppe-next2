package aiusage

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

type memStore struct {
	mu    sync.Mutex
	calls []Call
}

func (m *memStore) Insert(_ context.Context, c Call) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, c)
	return nil
}

func (m *memStore) CostSince(_ context.Context, from time.Time) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var sum int64
	for _, c := range m.calls {
		if !c.At.Before(from) {
			sum += c.CostMicroUSD
		}
	}
	return sum, nil
}

type coded struct{}

func (coded) Error() string     { return "the provider refused" }
func (coded) ErrorCode() string { return "content_policy_violation" }

func TestCostIsTokensTimesPricesRoundedUp(t *testing.T) {
	p := DefaultPrices["gpt-image-2"]
	// 1 000 image tokens in at $8/M = 8 000 µ$; 4 160 out at $30/M = 124 800 µ$; 30 text in at $5/M = 150 µ$.
	if got := p.Cost(Tokens{InputText: 30, InputImage: 1000, OutputImage: 4160}); got != 132950 {
		t.Errorf("cost = %d µ$, want 132950", got)
	}
	if got := (Prices{InputText: 0.1}).Cost(Tokens{InputText: 3}); got != 1 {
		t.Errorf("a part of a micro-dollar = %d, want 1 (rounded up)", got)
	}
}

func TestRunRecordsEveryCall(t *testing.T) {
	store := &memStore{}
	now := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	s := NewService(store, WithClock(func() time.Time { return now }))
	prices := DefaultPrices["gpt-image-2"]
	emp := uuid.New()
	req := Request{Operation: PortraitColorize, Provider: "openai", Model: "gpt-image-2", Prices: &prices, UserID: uuid.New(), EmployeeID: &emp}

	if err := s.Run(context.Background(), req, func(context.Context) (Result, error) {
		return Result{Tokens: Tokens{InputImage: 1000, OutputImage: 4160}, ProviderRequestID: "req_1"}, nil
	}); err != nil {
		t.Fatal(err)
	}
	ok := store.calls[0]
	if ok.Outcome != OK || ok.CostMicroUSD != 132800 || ok.ProviderRequestID != "req_1" || ok.Prices != prices || *ok.EmployeeID != emp {
		t.Errorf("ok call = %+v", ok)
	}

	// A failed call keeps the tokens the provider reported, and its error code.
	err := s.Run(context.Background(), req, func(context.Context) (Result, error) {
		return Result{Tokens: Tokens{InputImage: 1000}}, coded{}
	})
	if err == nil || store.calls[1].Outcome != Failed || store.calls[1].ErrorCode != "content_policy_violation" || store.calls[1].CostMicroUSD != 8000 {
		t.Errorf("failed call = %+v, %v", store.calls[1], err)
	}

	// A model without prices is refused, nothing called.
	called := false
	noPrices := req
	noPrices.Prices = nil
	if err := s.Run(context.Background(), noPrices, func(context.Context) (Result, error) { called = true; return Result{}, nil }); !errors.Is(err, ErrNoPrices) || called {
		t.Errorf("no prices = %v, called %v", err, called)
	}
	if c := store.calls[2]; c.Outcome != Refused || c.ErrorCode != "no_prices" || c.CostMicroUSD != 0 {
		t.Errorf("refused call = %+v", c)
	}
}

func TestBudgetRefusesOnceSpent(t *testing.T) {
	store := &memStore{}
	now := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	s := NewService(store, WithClock(func() time.Time { return now }))
	prices := DefaultPrices["gpt-image-2"]
	budget := int64(200000) // $0.20
	req := Request{Operation: PortraitColorize, Provider: "openai", Model: "gpt-image-2", Prices: &prices, Budget: &budget, UserID: uuid.New()}
	call := func(context.Context) (Result, error) { return Result{Tokens: Tokens{OutputImage: 4000}}, nil } // 120 000 µ$
	// Last month's spending does not count.
	store.calls = append(store.calls, Call{At: now.AddDate(0, -1, 0), CostMicroUSD: 1_000_000})
	for i := range 2 {
		if err := s.Run(context.Background(), req, call); err != nil {
			t.Fatalf("call %d: %v", i+1, err)
		}
	}
	// 240 000 µ$ spent this month, over the budget: the third is refused.
	if err := s.Run(context.Background(), req, call); !errors.Is(err, ErrBudgetSpent) {
		t.Errorf("over budget = %v", err)
	}
	if spent, _ := s.SpentThisMonth(context.Background()); spent != 240000 {
		t.Errorf("spent = %d", spent)
	}
	if got := Operations(); len(got) != 1 || got[0] != "portrait.colorize" {
		t.Errorf("operations = %v", got)
	}
}
