package backup

import (
	"context"
	"time"
)

// Service reports the backups and whether they need attention.
type Service struct {
	repo Repository
	now  func() time.Time
	loc  *time.Location
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

// Status reads the backups and derives the warnings.
func (s *Service) Status(ctx context.Context) (Status, error) {
	st, err := s.repo.Read(ctx, RunLimit)
	if err != nil {
		return Status{}, err
	}
	now := s.now()
	st.GeneratedAt = now
	st.Timezone = s.loc.String()
	if st.Runs == nil {
		st.Runs = []Run{}
	}
	for i := range st.Runs {
		st.Runs[i].DurationMS = st.Runs[i].FinishedAt.Sub(st.Runs[i].StartedAt).Milliseconds()
	}
	if st.LastSuccess != nil {
		st.LastSuccess.DurationMS = st.LastSuccess.FinishedAt.Sub(st.LastSuccess.StartedAt).Milliseconds()
	}

	interval := DefaultInterval
	if st.Agent != nil && st.Agent.IntervalSeconds > 0 {
		interval = time.Duration(st.Agent.IntervalSeconds) * time.Second
	}
	st.Stale = st.LastSuccess == nil || now.Sub(st.LastSuccess.StartedAt) > interval+Grace
	st.AgentOffline = st.Agent == nil || now.Sub(st.Agent.LastSeenAt) > OfflineAfter
	st.LastRunFailed = len(st.Runs) > 0 && st.Runs[0].Status == StatusFailed
	return st, nil
}
