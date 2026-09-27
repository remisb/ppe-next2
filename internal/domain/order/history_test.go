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

// A record number is found however it is typed; the filter keeps that one order.
func TestParseRecordNumber(t *testing.T) {
	for in, want := range map[string]int64{"WE-000004": 4, "we4": 4, "WE 12": 12, " 000123 ": 123, "7": 7} {
		if got, ok := ParseRecordNumber(in); !ok || got != want {
			t.Errorf("%q = %d %v, want %d", in, got, ok, want)
		}
	}
	for _, in := range []string{"", "WE-", "WE-0", "WE-12a", "X-4", "-4", "1234567890123"} {
		if _, ok := ParseRecordNumber(in); ok {
			t.Errorf("%q parsed", in)
		}
	}
	f, _, _, err := ListParams{Record: "we-4"}.filter(time.UTC)
	if err != nil || f.RecordSeq == nil || *f.RecordSeq != 4 {
		t.Errorf("record filter = %v, %v", f.RecordSeq, err)
	}
	if FormatRecordNumber(4) != "WE-000004" {
		t.Error("format")
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
		"bad record":    {Record: "WE-12a"},
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
