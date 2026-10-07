package audit

import (
	"context"
	"fmt"
	"time"
)

// A seal is anchored outside the database by a trusted timestamp of its hash
// (RFC 3161, internal/tsa; ADR 0003): a timestamp service signs that the hash
// existed at that time. Each seal's hash covers the day before, so a stamp
// fixes every earlier day too. Someone who rewrites the trail must rewrite the
// seals after it, and cannot get stamps for them with their original times.

// Stamp is a seal's trusted timestamp (audit_seal_stamps, migration 0028).
type Stamp struct {
	Day time.Time `json:"day"`
	// TSA is the timestamp service's URL; Token its signed answer (DER).
	TSA   string `json:"tsa"`
	Token []byte `json:"-"`
	// StampedAt is the time the token states; RecordedAt when it was stored.
	StampedAt  time.Time `json:"stamped_at"`
	RecordedAt time.Time `json:"recorded_at"`
}

// StampGrace is how long after its day can be sealed a seal may wait for its
// timestamp, which is retried every hour. A stamp made later, or a seal
// without one by then, could be a rewritten seal's: Verify reports it.
const StampGrace = 7 * Day

// StampOverdue is when a seal still waiting for its timestamp is reported, so
// the cause (the service is unreachable) is put right before StampGrace.
const StampOverdue = Day

// StampsFrom is the first day whose seal must be timestamped in time: the
// day after stamping was built. Earlier seals are stamped when it is turned
// on, and the chain makes the first stamp in time cover them.
var StampsFrom = time.Date(2026, 10, 8, 0, 0, 0, 0, time.UTC)

// Timestamps gets and checks trusted timestamps of seal hashes (tsa.Client).
type Timestamps interface {
	// URL names the timestamp service.
	URL() string
	// Stamp returns a checked token for digest, a SHA-256 hash.
	Stamp(ctx context.Context, digest []byte) ([]byte, error)
	// Check returns the time token states, if it is a trusted timestamp of digest.
	Check(token, digest []byte) (time.Time, error)
}

// ErrStamped: the day has a timestamp already (another instance stamped it).
var ErrStamped = fmt.Errorf("day already timestamped")

// WithTimestamps anchors the seals with t; without it nothing is stamped or
// checked against a stamp.
func WithTimestamps(t Timestamps) Option { return func(s *Service) { s.stamps = t } }

// WithStampsFrom replaces StampsFrom, for tests.
func WithStampsFrom(day time.Time) Option { return func(s *Service) { s.stampsFrom = day } }

// Timestamped reports whether seals are timestamped, and by which service.
func (s *Service) Timestamped() (bool, string) {
	if s.stamps == nil {
		return false, ""
	}
	return true, s.stamps.URL()
}

// stampDeadline is when a seal of day must have its timestamp.
func stampDeadline(day time.Time) time.Time { return day.Add(Day + SealGrace + StampGrace) }

// StampDays gets a timestamp for every seal without one, oldest first, and
// returns how many it stored. It stops at the first failure; the next run
// carries on.
func (s *Service) StampDays(ctx context.Context) (int, error) {
	if s.stamps == nil {
		return 0, nil
	}
	seals, err := s.seals.Seals(ctx)
	if err != nil {
		return 0, err
	}
	stamps, err := s.seals.Stamps(ctx)
	if err != nil {
		return 0, err
	}
	have := make(map[time.Time]bool, len(stamps))
	for _, st := range stamps {
		have[st.Day] = true
	}
	stamped := 0
	for _, seal := range seals {
		if have[seal.Day] {
			continue
		}
		token, err := s.stamps.Stamp(ctx, seal.Hash)
		if err != nil {
			return stamped, err
		}
		at, err := s.stamps.Check(token, seal.Hash)
		if err != nil {
			return stamped, err
		}
		st := Stamp{Day: seal.Day, TSA: s.stamps.URL(), Token: token, StampedAt: at, RecordedAt: s.now()}
		if err := s.seals.AddStamp(ctx, st); err != nil {
			if err == ErrStamped {
				continue
			}
			return stamped, err
		}
		stamped++
	}
	return stamped, nil
}

// Stamps are every seal's timestamp, oldest day first.
func (s *Service) Stamps(ctx context.Context) ([]Stamp, error) { return s.seals.Stamps(ctx) }

// checkStamp is Verify's check of seal against its timestamp st (nil for
// none): "" when it is in order, else the problem.
func (s *Service) checkStamp(seal Seal, st *Stamp, v *Verification) string {
	required := !seal.Day.Before(s.stampsFrom)
	if st == nil {
		if !required {
			return ""
		}
		if s.now().After(stampDeadline(seal.Day)) {
			return "unstamped"
		}
		v.StampsWaiting++
		if s.now().After(seal.Day.Add(Day + SealGrace + StampOverdue)) {
			v.StampsOverdue++
		}
		return ""
	}
	at, err := s.stamps.Check(st.Token, seal.Hash)
	if err != nil {
		return "stamp"
	}
	if required && at.After(stampDeadline(seal.Day)) {
		return "late"
	}
	v.Stamped++
	day := seal.Day
	v.LastStamped = &day
	return ""
}
