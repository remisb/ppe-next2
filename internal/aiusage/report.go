package aiusage

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// The AI Usage screen's reads (docs/specs/ai-usage-service.md): this month
// against the budget, the months' cost, the split by operation, user and
// model over a period, and the calls themselves.

// Sum is calls and their cost.
type Sum struct {
	Calls        int   `json:"calls"`
	CostMicroUSD int64 `json:"cost_micro_usd"`
}

// MonthSum is a month's (YYYY-MM, the organisation's).
type MonthSum struct {
	Month string `json:"month"`
	Sum
}

// KeySum is a part of the period's: an operation, a model, or a user (by id).
type KeySum struct {
	Key string `json:"key"`
	// Name is the user's name, for a part by user.
	Name string `json:"name,omitempty"`
	Sum
}

// Report is the screen's figures.
type Report struct {
	ThisMonth      Sum        `json:"this_month"`
	BudgetMicroUSD *int64     `json:"budget_micro_usd"`
	Months         []MonthSum `json:"months"`
	ByOperation    []KeySum   `json:"by_operation"`
	ByUser         []KeySum   `json:"by_user"`
	ByModel        []KeySum   `json:"by_model"`
}

// Filter narrows the calls; zero values are no filter.
type Filter struct {
	From, To  time.Time
	Operation Operation
	UserID    uuid.UUID
	Outcome   Outcome
	Limit     int
	Offset    int
}

// ReportStore answers the screen's reads.
type ReportStore interface {
	// Sums are the calls since from, by month (in tz), operation, user and model.
	Sums(ctx context.Context, from time.Time, tz string) (months []MonthSum, byOperation, byUser, byModel []KeySum, err error)
	Calls(ctx context.Context, f Filter) ([]Call, error)
}

// MonthsShown is how many months the screen's chart covers.
const MonthsShown = 12

// Report is this month against the budget and the last MonthsShown months.
func (s *Service) Report(ctx context.Context, store ReportStore, budget *int64) (Report, error) {
	now := s.now()
	from := s.monthStart(now).AddDate(0, -(MonthsShown - 1), 0)
	months, byOp, byUser, byModel, err := store.Sums(ctx, from, s.loc.String())
	if err != nil {
		return Report{}, err
	}
	r := Report{BudgetMicroUSD: budget, Months: months, ByOperation: byOp, ByUser: byUser, ByModel: byModel}
	this := s.monthStart(now).Format("2006-01")
	for _, m := range months {
		if m.Month == this {
			r.ThisMonth = m.Sum
		}
	}
	return r, nil
}
