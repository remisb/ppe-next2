package dashboard

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/domain/order"
	"github.com/remisb/ppe-next2/internal/domain/size"
)

// Service computes the dashboards of the administrator, the manager and the
// employee role (the staff who prepare orders).
type Service struct {
	repo Repository
	now  func() time.Time
	// loc is the organisation's timezone: months and day counts follow its calendar.
	loc *time.Location
	// limit caps the dashboards' lists.
	limit int
}

type Option func(*Service)

func WithClock(now func() time.Time) Option  { return func(s *Service) { s.now = now } }
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, loc: time.UTC, limit: ListLimit}
	for _, o := range opts {
		o(s)
	}
	return s
}

// window is the period the dashboard covers at now.
func (s *Service) window(now time.Time) Window {
	local := now.In(s.loc)
	current := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, s.loc)
	starts := make([]time.Time, Months+1)
	for i := range starts {
		starts[i] = current.AddDate(0, i-(Months-1), 0).UTC()
	}
	return Window{
		Now:          now,
		MonthStarts:  starts,
		DueBy:        now.AddDate(0, 0, DueSoonDays),
		ConfirmSince: now.AddDate(0, 0, -ConfirmWindowDays),
		Limit:        s.limit,
	}
}

// Overview reads the figures and derives the labels, ages and rounding.
func (s *Service) Overview(ctx context.Context) (Overview, error) {
	now := s.now()
	w := s.window(now)
	o, err := s.repo.Read(ctx, w)
	if err != nil {
		return Overview{}, err
	}
	o.GeneratedAt, o.Timezone = now, s.loc.String()

	for i := range o.Months {
		o.Months[i].Month = w.MonthStarts[i].In(s.loc).Format("2006-01")
	}
	for i := range o.Awaiting.Longest {
		l := &o.Awaiting.Longest[i]
		l.RecordNumber = order.FormatRecordNumber(l.RecordSeq)
		l.Days = s.days(l.OrderedAt, now)
	}
	if len(o.Awaiting.Longest) > 0 {
		d := o.Awaiting.Longest[0].Days
		o.Awaiting.OldestDays = &d
	}

	o.Confirmation.WindowDays = ConfirmWindowDays
	if sec := o.Confirmation.MedianSeconds; sec != nil {
		d := math.Round(*sec/86400*10) / 10
		o.Confirmation.MedianDays = &d
	}

	s.replacements(&o.Replacements, now)
	return o, nil
}

// days counts calendar days in the organisation's timezone from t to now, so
// an order placed yesterday evening is one day old this morning.
func (s *Service) days(t, now time.Time) int {
	a, b := t.In(s.loc), now.In(s.loc)
	da := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, time.UTC)
	db := time.Date(b.Year(), b.Month(), b.Day(), 0, 0, 0, 0, time.UTC)
	return max(0, int(db.Sub(da).Hours()/24))
}

// Manager is the manager's dashboard.
func (s *Service) Manager(ctx context.Context) (ManagerOverview, error) {
	now := s.now()
	months := s.window(now).MonthStarts
	f, err := s.repo.ReadManager(ctx, ManagerWindow{
		Now:               now,
		MonthStarts:       months,
		ForecastBy:        now.AddDate(0, 0, ForecastDays),
		PriceChangesSince: months[0],
		Limit:             ListLimit,
	})
	if err != nil {
		return ManagerOverview{}, err
	}
	o := f.ManagerOverview
	o.GeneratedAt, o.Timezone = now, s.loc.String()
	for i := range o.Months {
		o.Months[i].Month = months[i].In(s.loc).Format("2006-01")
	}
	o.Forecast = forecast(o.Forecast.Lines, s.limit)
	o.Sizes = spread(f.SizeGroups)
	return o, nil
}

// Employee is the dashboard of the employee role for userID, the signed-in
// user: their own orders, and what the organisation needs ordered next.
func (s *Service) Employee(ctx context.Context, userID uuid.UUID) (EmployeeOverview, error) {
	if userID == uuid.Nil {
		return EmployeeOverview{}, fmt.Errorf("%w: user is required", ErrInvalid)
	}
	now := s.now()
	w := s.window(now)
	o, err := s.repo.ReadEmployee(ctx, EmployeeWindow{
		Now:         now,
		UserID:      userID,
		MonthStarts: w.MonthStarts,
		DueBy:       w.DueBy,
		Limit:       s.limit,
	})
	if err != nil {
		return EmployeeOverview{}, err
	}
	o.GeneratedAt, o.Timezone = now, s.loc.String()
	for i := range o.Months {
		o.Months[i].Month = w.MonthStarts[i].In(s.loc).Format("2006-01")
	}
	for i := range o.Awaiting.Longest {
		l := &o.Awaiting.Longest[i]
		l.RecordNumber = order.FormatRecordNumber(l.RecordSeq)
		l.Days = s.days(l.OrderedAt, now)
	}
	if len(o.Awaiting.Longest) > 0 {
		d := o.Awaiting.Longest[0].Days
		o.Awaiting.OldestDays = &d
	}
	for i := range o.RecentlyGiven {
		o.RecentlyGiven[i].RecordNumber = order.FormatRecordNumber(o.RecentlyGiven[i].RecordSeq)
	}
	s.replacements(&o.Replacements, now)
	return o, nil
}

// replacements fills the derived fields of r at now.
func (s *Service) replacements(r *Replacements, now time.Time) {
	r.DueSoonDays = DueSoonDays
	for i := range r.Next {
		x := &r.Next[i]
		x.RecordNumber = order.FormatRecordNumber(x.RecordSeq)
		x.Overdue = !x.DueAt.After(now)
	}
}

// spread counts employees by the size Create Order would use for them.
func spread(groups []EmployeeSizes) SizeSpread {
	clothing := map[string]int{}
	shoes := map[string]int{}
	var out SizeSpread
	for _, g := range groups {
		r := size.Resolve(size.GroupClothing, size.Defaults{ClothingSize: g.ClothingSize, HeightCm: g.HeightCm})
		if r.Size == nil {
			out.NoClothing += g.Employees
		} else {
			clothing[*r.Size] += g.Employees
			if r.Suggested {
				out.Suggested += g.Employees
			}
		}
		if g.ShoeSize == nil {
			out.NoShoes += g.Employees
		} else {
			shoes[*g.ShoeSize] += g.Employees
		}
	}
	for _, c := range size.Clothing() {
		out.Clothing = append(out.Clothing, SizeCount{Size: c.Code, Employees: clothing[c.Code]})
	}
	for _, c := range size.Shoes() {
		out.Shoes = append(out.Shoes, SizeCount{Size: c.Code, Employees: shoes[c.Code]})
	}
	return out
}

// forecast totals the replacement demand over every line, costs each line at
// its current price, and keeps the largest limit lines.
func forecast(lines []ForecastLine, limit int) Forecast {
	f := Forecast{Days: ForecastDays, Lines: lines}
	for i := range f.Lines {
		l := &f.Lines[i]
		f.Items += l.Quantity
		if l.UnitPriceCents == nil {
			f.Unpriced += l.Quantity
			continue
		}
		c := *l.UnitPriceCents * int64(l.Quantity)
		l.EstimatedCents = &c
		f.EstimatedCents += c
	}
	if len(f.Lines) > limit {
		f.Lines = f.Lines[:limit]
	}
	if f.Lines == nil {
		f.Lines = []ForecastLine{}
	}
	return f
}
