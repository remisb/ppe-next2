package order

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func vilnius(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Vilnius")
	if err != nil {
		t.Fatal(err)
	}
	return loc
}

func TestListParamsDatesUseOrganisationTimezone(t *testing.T) {
	loc := vilnius(t) // UTC+3 in September
	f, page, size, err := ListParams{FromDate: "2026-09-24", ToDate: "2026-09-24"}.filter(loc)
	if err != nil {
		t.Fatal(err)
	}
	if !f.From.Equal(time.Date(2026, 9, 23, 21, 0, 0, 0, time.UTC)) || !f.To.Equal(time.Date(2026, 9, 24, 21, 0, 0, 0, time.UTC)) {
		t.Errorf("window = %v .. %v", f.From, f.To)
	}
	if page != 1 || size != DefaultPageSize || f.Limit != DefaultPageSize || f.Offset != 0 || f.Status != nil {
		t.Errorf("defaults = page %d size %d filter %+v", page, size, f)
	}
	// Newest activity first by default; any other column defaults to ascending.
	if f.Sort != SortDate || !f.Desc {
		t.Errorf("default sort = %s desc %v", f.Sort, f.Desc)
	}
	if f, _, _, _ = (ListParams{Sort: "total"}).filter(loc); f.Sort != SortTotal || f.Desc {
		t.Errorf("total sort = %s desc %v", f.Sort, f.Desc)
	}
	if f, _, _, _ = (ListParams{Sort: "employee", Dir: "desc"}).filter(loc); f.Sort != SortEmployee || !f.Desc {
		t.Errorf("employee desc = %s desc %v", f.Sort, f.Desc)
	}
	f, _, _, _ = ListParams{Status: "GIVEN", Page: 3, PageSize: 10}.filter(loc)
	if *f.Status != StatusGiven || f.Offset != 20 || f.Limit != 10 {
		t.Errorf("paging = %+v", f)
	}
}

func TestListParamsRejections(t *testing.T) {
	for name, p := range map[string]ListParams{
		"bad status":    {Status: "DRAFT"},
		"bad date":      {FromDate: "24.09.2026"},
		"from after to": {FromDate: "2026-09-25", ToDate: "2026-09-24"},
		"page 0 size":   {PageSize: 101},
		"negative page": {Page: -1},
		"unknown sort":  {Sort: "price"},
		"bad direction": {Sort: "total", Dir: "down"},
	} {
		if _, _, _, err := p.filter(time.UTC); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
}

func TestListAddsUsageTimeForGivenOnly(t *testing.T) {
	loc := vilnius(t)
	now := time.Date(2026, 9, 24, 12, 0, 0, 0, time.UTC)
	given := now.AddDate(0, 0, -64)
	repo := &fakeRepo{orders: map[uuid.UUID]Order{
		uuid.New(): {Status: StatusGiven, GivenAt: &given},
		uuid.New(): {Status: StatusOrdered},
	}}
	svc := NewService(repo, Readers{}, WithClock(func() time.Time { return now }), WithLocation(loc))
	res, err := svc.List(context.Background(), ListParams{Status: "", Page: 2, PageSize: 5})
	if err != nil {
		t.Fatal(err)
	}
	if res.Page != 2 || res.PageSize != 5 || res.Total != 2 || repo.lastFilter.Offset != 5 {
		t.Errorf("result = %+v filter %+v", res, repo.lastFilter)
	}
	for _, o := range res.Orders {
		switch o.Status {
		case StatusGiven:
			if o.UsageMonths == nil || *o.UsageMonths != 2.1 {
				t.Errorf("given usage = %v", o.UsageMonths)
			}
		case StatusOrdered:
			if o.UsageMonths != nil {
				t.Errorf("ordered usage = %v, want none", *o.UsageMonths)
			}
		}
	}
}
