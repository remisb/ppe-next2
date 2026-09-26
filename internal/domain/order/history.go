package order

import (
	"context"
	"time"

	"github.com/google/uuid"
)

const (
	DefaultPageSize = 20
	MaxPageSize     = 100
	dateLayout      = "2006-01-02"
)

// SortKey is a History column the list can be ordered by.
type SortKey string

const (
	// SortDate is the activity time, coalesce(given_at, ordered_at): the default, newest first.
	SortDate     SortKey = "date"
	SortRecord   SortKey = "record"
	SortEmployee SortKey = "employee"
	SortStatus   SortKey = "status"
	// SortUsage is usage time, so ascending means most recently given first;
	// ORDERED orders have none and always come last.
	SortUsage SortKey = "usage"
	SortTotal SortKey = "total"
)

var sortKeys = map[SortKey]bool{SortDate: true, SortRecord: true, SortEmployee: true, SortStatus: true, SortUsage: true, SortTotal: true}

// ListFilter is a History query in storage terms: UTC instants, To exclusive.
// Dates match an order's activity time, coalesce(given_at, ordered_at). Ties
// in Sort fall back to newest activity first, so pages are stable.
type ListFilter struct {
	EmployeeID *uuid.UUID
	// CatalogueItemID keeps orders with a line for that item.
	CatalogueItemID *uuid.UUID
	Status          *Status
	From            *time.Time
	To              *time.Time
	Sort            SortKey
	Desc            bool
	Limit           int
	Offset          int
}

// ListParams is a History query as the user states it: calendar dates in the
// organisation's timezone. Empty fields do not filter.
type ListParams struct {
	EmployeeID      *uuid.UUID
	CatalogueItemID *uuid.UUID
	Status          string // "", ORDERED or GIVEN
	FromDate        string // YYYY-MM-DD, inclusive
	ToDate          string // YYYY-MM-DD, inclusive
	Sort            string // a SortKey; "" means date
	Dir             string // "asc" or "desc"; "" means desc for date, asc otherwise
	Page            int    // 1-based; 0 means 1
	PageSize        int    // 0 means DefaultPageSize
}

// Listed is a stored order plus its usage time (algorithm D), which is only
// set for GIVEN orders.
type Listed struct {
	Order
	UsageMonths *float64
}

type ListResult struct {
	Orders   []Listed
	Page     int
	PageSize int
	Total    int
}

// filter converts the user's dates into UTC instants: FromDate starts at local
// midnight, and ToDate includes its whole local day.
func (p ListParams) filter(loc *time.Location) (ListFilter, int, int, error) {
	var f ListFilter
	page, size := p.Page, p.PageSize
	if page == 0 {
		page = 1
	}
	if size == 0 {
		size = DefaultPageSize
	}
	switch {
	case page < 1:
		return f, 0, 0, fieldError("page", "must be at least 1")
	case size < 1 || size > MaxPageSize:
		return f, 0, 0, fieldError("page_size", "must be between 1 and 100")
	}
	f.EmployeeID, f.CatalogueItemID = p.EmployeeID, p.CatalogueItemID
	f.Sort = SortKey(p.Sort)
	if f.Sort == "" {
		f.Sort = SortDate
	}
	if !sortKeys[f.Sort] {
		return f, 0, 0, fieldError("sort", "must be date, record, employee, status, usage or total")
	}
	switch p.Dir {
	case "":
		f.Desc = f.Sort == SortDate
	case "asc", "desc":
		f.Desc = p.Dir == "desc"
	default:
		return f, 0, 0, fieldError("dir", "must be asc or desc")
	}
	switch Status(p.Status) {
	case "":
	case StatusOrdered, StatusGiven:
		st := Status(p.Status)
		f.Status = &st
	default:
		return f, 0, 0, fieldError("status", "must be ORDERED or GIVEN")
	}
	if p.FromDate != "" {
		d, err := time.ParseInLocation(dateLayout, p.FromDate, loc)
		if err != nil {
			return f, 0, 0, fieldError("from", "must be a date like 2026-09-24")
		}
		u := d.UTC()
		f.From = &u
	}
	if p.ToDate != "" {
		d, err := time.ParseInLocation(dateLayout, p.ToDate, loc)
		if err != nil {
			return f, 0, 0, fieldError("to", "must be a date like 2026-09-24")
		}
		u := d.AddDate(0, 0, 1).UTC() // exclusive: the start of the next local day
		f.To = &u
	}
	if f.From != nil && f.To != nil && !f.From.Before(*f.To) {
		return f, 0, 0, fieldError("from", "must not be after to")
	}
	f.Limit, f.Offset = size, (page-1)*size
	return f, page, size, nil
}

// List is History: stored orders and their snapshots, newest activity first
// unless another sort is asked for.
// It never reads live catalogue or employee data.
func (s *Service) List(ctx context.Context, p ListParams) (ListResult, error) {
	f, page, size, err := p.filter(s.loc)
	if err != nil {
		return ListResult{}, err
	}
	orders, total, err := s.repo.List(ctx, f)
	if err != nil {
		return ListResult{}, err
	}
	now := s.now()
	out := ListResult{Orders: make([]Listed, len(orders)), Page: page, PageSize: size, Total: total}
	for i, o := range orders {
		out.Orders[i] = Listed{Order: o, UsageMonths: UsageMonths(o, now, s.loc)}
	}
	return out, nil
}
