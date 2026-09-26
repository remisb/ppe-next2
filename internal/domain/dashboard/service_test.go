package dashboard

import (
	"context"
	"testing"
	"time"
)

type fakeRepo struct {
	got    Window
	out    Overview
	gotMgr ManagerWindow
	outMgr ManagerFigures
}

func (f *fakeRepo) Read(_ context.Context, w Window) (Overview, error) {
	f.got = w
	return f.out, nil
}

func (f *fakeRepo) ReadManager(_ context.Context, w ManagerWindow) (ManagerFigures, error) {
	f.gotMgr = w
	return f.outMgr, nil
}

func utc(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t.UTC()
}

// Europe/Vilnius changes to summer time on 29 March 2026, the day "now" is in:
// months and day counts follow the local calendar, not UTC.
func TestOverviewWindowAndDerivedFields(t *testing.T) {
	vilnius, err := time.LoadLocation("Europe/Vilnius")
	if err != nil {
		t.Fatal(err)
	}
	now := utc("2026-03-29T12:00:00Z")
	sec := 1.26 * 86400
	repo := &fakeRepo{out: Overview{
		Months: make([]Month, Months),
		Awaiting: Awaiting{Orders: 2, Longest: []Waiting{
			{RecordSeq: 7, OrderedAt: utc("2026-03-28T21:30:00Z")}, // 23:30 on the 28th locally
			{RecordSeq: 9, OrderedAt: utc("2026-03-28T22:30:00Z")}, // 00:30 on the 29th locally
		}},
		Confirmation: Confirmation{Given: 3, MedianSeconds: &sec},
		Replacements: Replacements{Next: []Replacement{
			{RecordSeq: 3, DueAt: now},
			{RecordSeq: 4, DueAt: now.Add(time.Hour)},
		}},
	}}
	svc := NewService(repo, WithLocation(vilnius), WithClock(func() time.Time { return now }))

	o, err := svc.Overview(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	w := repo.got
	if len(w.MonthStarts) != Months+1 ||
		!w.MonthStarts[0].Equal(utc("2025-03-31T21:00:00Z")) || // 1 April 2025, summer time
		!w.MonthStarts[Months-1].Equal(utc("2026-02-28T22:00:00Z")) || // 1 March 2026, winter time
		!w.MonthStarts[Months].Equal(utc("2026-03-31T21:00:00Z")) { // 1 April 2026, summer time
		t.Errorf("month starts = %v", w.MonthStarts)
	}
	if !w.DueBy.Equal(now.AddDate(0, 0, DueSoonDays)) || !w.ConfirmSince.Equal(now.AddDate(0, 0, -ConfirmWindowDays)) || w.Limit != ListLimit {
		t.Errorf("window = %+v", w)
	}

	if o.Months[0].Month != "2025-04" || o.Months[Months-1].Month != "2026-03" {
		t.Errorf("month labels %q … %q", o.Months[0].Month, o.Months[Months-1].Month)
	}
	if l := o.Awaiting.Longest; l[0].Days != 1 || l[1].Days != 0 || l[0].RecordNumber != "WE-000007" {
		t.Errorf("waiting = %+v", l)
	}
	if o.Awaiting.OldestDays == nil || *o.Awaiting.OldestDays != 1 {
		t.Errorf("oldest days = %v", o.Awaiting.OldestDays)
	}
	if o.Confirmation.MedianDays == nil || *o.Confirmation.MedianDays != 1.3 || o.Confirmation.WindowDays != ConfirmWindowDays {
		t.Errorf("confirmation = %+v", o.Confirmation)
	}
	if r := o.Replacements.Next; !r[0].Overdue || r[1].Overdue || r[1].RecordNumber != "WE-000004" || o.Replacements.DueSoonDays != DueSoonDays {
		t.Errorf("replacements = %+v", o.Replacements)
	}
	if o.Timezone != "Europe/Vilnius" || !o.GeneratedAt.Equal(now) {
		t.Errorf("timezone %q, generated %v", o.Timezone, o.GeneratedAt)
	}
}

func TestOverviewWithNothingStored(t *testing.T) {
	svc := NewService(&fakeRepo{out: Overview{Months: make([]Month, Months)}})
	o, err := svc.Overview(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if o.Awaiting.OldestDays != nil || o.Confirmation.MedianDays != nil {
		t.Errorf("empty overview derived values: %+v", o)
	}
}

func sp(s string) *string { return &s }
func ip(i int) *int       { return &i }
func i64(i int64) *int64  { return &i }

func TestManagerDerivedFields(t *testing.T) {
	now := utc("2026-09-15T10:00:00Z")
	lines := []ForecastLine{
		{ItemName: "Gloves", Quantity: 20, UnitPriceCents: i64(250)},
		{ItemName: "Helmet", Quantity: 3},
	}
	for i := range ListLimit {
		lines = append(lines, ForecastLine{ItemName: "Filler", Quantity: 1, UnitPriceCents: i64(int64(100 + i))})
	}
	repo := &fakeRepo{outMgr: ManagerFigures{
		ManagerOverview: ManagerOverview{Months: make([]OrderedMonth, Months), Forecast: Forecast{Lines: lines}},
		SizeGroups: []EmployeeSizes{
			{ClothingSize: sp("M"), ShoeSize: sp("42"), Employees: 2},
			{HeightCm: ip(190), Employees: 1},                                            // suggested 2XL, no shoe size
			{HeightCm: ip(120), Employees: 1},                                            // too short to suggest: no clothing size
			{ClothingSize: sp("M"), HeightCm: ip(190), ShoeSize: sp("45"), Employees: 1}, // the saved size wins
		},
	}}
	svc := NewService(repo, WithClock(func() time.Time { return now }))
	o, err := svc.Manager(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if w := repo.gotMgr; !w.ForecastBy.Equal(now.AddDate(0, 0, ForecastDays)) || !w.PriceChangesSince.Equal(utc("2025-10-01T00:00:00Z")) {
		t.Errorf("window = %+v", w)
	}
	if o.Months[11].Month != "2026-09" {
		t.Errorf("last month %q", o.Months[11].Month)
	}
	f := o.Forecast
	var fillers int64
	for i := range ListLimit {
		fillers += int64(100 + i)
	}
	if f.Days != ForecastDays || f.Items != 23+ListLimit || f.Unpriced != 3 || f.EstimatedCents != 5000+fillers || len(f.Lines) != ListLimit {
		t.Errorf("forecast = %+v", f)
	}
	if *f.Lines[0].EstimatedCents != 5000 || f.Lines[1].EstimatedCents != nil {
		t.Errorf("line costs = %v, %v", f.Lines[0].EstimatedCents, f.Lines[1].EstimatedCents)
	}
	count := func(cs []SizeCount, size string) int {
		for _, c := range cs {
			if c.Size == size {
				return c.Employees
			}
		}
		return -1
	}
	s := o.Sizes
	if len(s.Clothing) != 6 || s.Clothing[0].Size != "S" || count(s.Clothing, "M") != 3 || count(s.Clothing, "2XL") != 1 ||
		s.Suggested != 1 || s.NoClothing != 1 || count(s.Shoes, "42") != 2 || count(s.Shoes, "45") != 1 || s.NoShoes != 2 || len(s.Shoes) != 8 {
		t.Errorf("sizes = %+v", s)
	}
}
