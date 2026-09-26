package dashboard

import (
	"context"
	"math"
	"time"

	"github.com/remisb/ppe-next2/internal/domain/order"
)

// Service computes the administrator's dashboard.
type Service struct {
	repo Repository
	now  func() time.Time
	// loc is the organisation's timezone: months and day counts follow its calendar.
	loc *time.Location
}

type Option func(*Service)

func WithClock(now func() time.Time) Option  { return func(s *Service) { s.now = now } }
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

func NewService(repo Repository, opts ...Option) *Service {
	s := &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, loc: time.UTC}
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
		Limit:        ListLimit,
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

	o.Replacements.DueSoonDays = DueSoonDays
	for i := range o.Replacements.Next {
		r := &o.Replacements.Next[i]
		r.RecordNumber = order.FormatRecordNumber(r.RecordSeq)
		r.Overdue = !r.DueAt.After(now)
	}
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
