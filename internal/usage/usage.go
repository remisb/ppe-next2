// Package usage is Administration's Usage screen: who uses the system, how
// and from what, the confirmation-link funnel and the data's quality over
// time. Like internal/audit it is infrastructure: the API's middleware tells
// it who was active (Seen), the upkeep samples the data's quality, and it
// reads the rest from what the domains already store. There are no page-view
// trackers: server events answer these questions without a consent banner.
package usage

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// Spans the report covers.
const (
	// Days is the daily series' length, ending today.
	Days = 30
	// Weeks is the weekly heat strip's length, ending this week.
	Weeks = 12
	// FunnelDays is how far back the confirmation-link funnel counts links.
	FunnelDays = 90
	// QualityDays is how far back the data-quality trend reaches.
	QualityDays = 90
	// ActivityKept is how long user_activity rows are kept.
	ActivityKept = 400 * 24 * time.Hour
	// TopPeople is how many of the most active people the report names.
	TopPeople = 8
	// DeviceLimit is how many distinct browsers the report lists.
	DeviceLimit = 200
)

// Apps are where activity is counted (audit.Source's apps).
var Apps = []string{"workwear", "admin", "api"}

// Role names a role in the report; Key is set on the built-in ones.
type Role struct {
	ID   uuid.UUID `json:"id"`
	Key  *string   `json:"key"`
	Name string    `json:"name"`
}

// RoleSeries is a role's active people per day.
type RoleSeries struct {
	Role   Role  `json:"role"`
	Values []int `json:"values"`
}

// Active is how many people used the system.
type Active struct {
	// Total, and ByApp, are per day of Report.Days: distinct people.
	Total  []int            `json:"total"`
	ByApp  map[string][]int `json:"by_app"`
	ByRole []RoleSeries     `json:"by_role"`
	// Last7 and Last30 are distinct people in the last 7 and 30 days; Users
	// the active accounts they are out of.
	Last7  int `json:"last_7"`
	Last30 int `json:"last_30"`
	Users  int `json:"users"`
}

// Device is one browser (User-Agent) and how many people used it in the
// last Days days; the app names it.
type Device struct {
	UserAgent string `json:"user_agent"`
	People    int    `json:"people"`
}

// AreaWeeks are an Audit log area's changes per week of Report.Weeks.
type AreaWeeks struct {
	Area   string `json:"area"`
	Counts []int  `json:"counts"`
}

// Person is one of the most active people.
type Person struct {
	ID      uuid.UUID `json:"id"`
	Name    string    `json:"name"`
	Changes int       `json:"changes"`
}

// Funnel follows the confirmation links created in the last FunnelDays.
type Funnel struct {
	Created   int `json:"created"`
	Opened    int `json:"opened"`
	Confirmed int `json:"confirmed"`
	// Waiting are still usable; Expired ran out unconfirmed; Replaced were
	// revoked by a newer link or a paper or in-person confirmation.
	Waiting  int `json:"waiting"`
	Expired  int `json:"expired"`
	Replaced int `json:"replaced"`
}

// Quality is the data's setup figures on a day (the Dashboard's Setup).
type Quality struct {
	Day                   time.Time `json:"day"`
	Employees             int       `json:"employees"`
	EmployeesMissingSizes int       `json:"employees_missing_sizes"`
	CatalogueActive       int       `json:"catalogue_active"`
	CatalogueUnpriced     int       `json:"catalogue_unpriced"`
	ItemSetsActive        int       `json:"item_sets_active"`
}

// Report is the Usage screen.
type Report struct {
	// Days are the daily series' days, oldest first (YYYY-MM-DD in the
	// organisation's timezone); Weeks the heat strip's Mondays.
	Days    []string `json:"days"`
	Weeks   []string `json:"weeks"`
	Active  Active   `json:"active"`
	SignIns []int    `json:"sign_ins"`
	Failed  []int    `json:"failed_sign_ins"`
	Devices []Device `json:"devices"`
	// UserLanguages and EmployeeLanguages count by language; "" is an
	// employee with none recorded.
	UserLanguages     map[string]int `json:"user_languages"`
	EmployeeLanguages map[string]int `json:"employee_languages"`
	Changes           []AreaWeeks    `json:"changes"`
	TopPeople         []Person       `json:"top_people"`
	Funnel            Funnel         `json:"funnel"`
	Quality           []Quality      `json:"quality"`
	Timezone          string         `json:"timezone"`
}

// Window is what the store reads: days and weeks as calendar dates in Loc.
type Window struct {
	Loc       *time.Location
	Now       time.Time
	FirstDay  time.Time // the first of Days days, midnight in Loc
	FirstWeek time.Time // the Monday Weeks weeks back, midnight in Loc
}

// Store reads the report and writes activity and quality samples.
type Store interface {
	// RecordActivity notes userID used app on day; again is a no-op.
	RecordActivity(ctx context.Context, day time.Time, userID uuid.UUID, app string) error
	// PurgeActivity deletes the activity before day.
	PurgeActivity(ctx context.Context, before time.Time) (int64, error)
	// SampleQuality records q for its day, replacing that day's.
	SampleQuality(ctx context.Context, q Quality) error
	// Read fills the report for w; Days, Weeks and Timezone are the service's.
	Read(ctx context.Context, w Window) (Report, error)
}

// Service records activity and builds the report.
type Service struct {
	store Store
	loc   *time.Location
	now   func() time.Time

	mu   sync.Mutex
	day  string
	seen map[string]bool
}

type Option func(*Service)

func WithClock(now func() time.Time) Option { return func(s *Service) { s.now = now } }

// WithLocation sets the organisation's timezone, whose calendar days the
// report counts in. The default is UTC.
func WithLocation(loc *time.Location) Option { return func(s *Service) { s.loc = loc } }

func NewService(store Store, opts ...Option) *Service {
	s := &Service{store: store, loc: time.UTC, now: time.Now, seen: map[string]bool{}}
	for _, o := range opts {
		o(s)
	}
	return s
}

// dayOf is t's calendar day in the organisation's timezone, as a date.
func (s *Service) dayOf(t time.Time) time.Time {
	l := t.In(s.loc)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, time.UTC)
}

// Seen notes that userID used app now. It writes once per user, app and day
// in this process; the database ignores a repeat from another.
func (s *Service) Seen(ctx context.Context, userID uuid.UUID, app string) error {
	day := s.dayOf(s.now())
	key := userID.String() + "|" + app
	s.mu.Lock()
	if d := day.Format(time.DateOnly); s.day != d {
		s.day, s.seen = d, map[string]bool{}
	}
	if s.seen[key] {
		s.mu.Unlock()
		return nil
	}
	s.seen[key] = true
	s.mu.Unlock()
	if err := s.store.RecordActivity(ctx, day, userID, app); err != nil {
		s.mu.Lock()
		delete(s.seen, key)
		s.mu.Unlock()
		return err
	}
	return nil
}

// PurgeActivity deletes activity older than ActivityKept.
func (s *Service) PurgeActivity(ctx context.Context) (int64, error) {
	return s.store.PurgeActivity(ctx, s.dayOf(s.now().Add(-ActivityKept)))
}

// SampleQuality records today's setup figures (q without its day).
func (s *Service) SampleQuality(ctx context.Context, q Quality) error {
	q.Day = s.dayOf(s.now())
	return s.store.SampleQuality(ctx, q)
}

// Report is the Usage screen now.
func (s *Service) Report(ctx context.Context) (Report, error) {
	now := s.now()
	local := now.In(s.loc)
	today := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, s.loc)
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	w := Window{Loc: s.loc, Now: now, FirstDay: today.AddDate(0, 0, -(Days - 1)), FirstWeek: monday.AddDate(0, 0, -7*(Weeks-1))}
	r, err := s.store.Read(ctx, w)
	if err != nil {
		return Report{}, err
	}
	r.Days = make([]string, Days)
	for i := range r.Days {
		r.Days[i] = w.FirstDay.AddDate(0, 0, i).Format(time.DateOnly)
	}
	r.Weeks = make([]string, Weeks)
	for i := range r.Weeks {
		r.Weeks[i] = w.FirstWeek.AddDate(0, 0, 7*i).Format(time.DateOnly)
	}
	r.Timezone = s.loc.String()
	return r, nil
}
