package audit

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"hash"
	"time"

	"github.com/google/uuid"
)

// Day is a seal's span: one UTC calendar day.
const Day = 24 * time.Hour

// SealGrace is how long after a day ends it is sealed: an event is written
// with the time its service took, and its transaction may commit a little
// later.
const SealGrace = time.Hour

// Row is one audit_events row exactly as stored, for sealing. Before and
// After are the JSON as Postgres prints jsonb, whose key order is fixed.
type Row struct {
	ID         uuid.UUID
	ActorID    *uuid.UUID
	Event      string
	EntityType string
	EntityID   uuid.UUID
	OccurredAt time.Time
	Before     *string
	After      *string
	RequestID  *string
	SessionID  *uuid.UUID
	Source     *string
}

// line is the row's canonical form: a JSON array of every column, the time
// in UTC to the microsecond as Postgres keeps it.
func (r Row) line() []byte {
	b, _ := json.Marshal([]any{
		r.ID, r.ActorID, r.Event, r.EntityType, r.EntityID,
		r.OccurredAt.UTC().Format("2006-01-02T15:04:05.000000Z"),
		r.Before, r.After, r.RequestID, r.SessionID, r.Source,
	})
	return append(b, '\n')
}

// Seal is one day's seal (audit_seals, migration 0026): how many events the
// day held and a hash over them and the previous seal, so changing, adding or
// removing a sealed event, or a seal, shows.
type Seal struct {
	Day      time.Time `json:"day"`
	Rows     int       `json:"rows"`
	Hash     []byte    `json:"hash"`
	PrevHash []byte    `json:"prev_hash"`
	SealedAt time.Time `json:"sealed_at"`
}

// Purge is one deletion of the events before BeforeDay (audit_purges).
type Purge struct {
	ID        uuid.UUID `json:"id"`
	BeforeDay time.Time `json:"before_day"`
	Rows      int64     `json:"rows"`
	PurgedAt  time.Time `json:"purged_at"`
}

// digest hashes a day's rows in order.
type digest struct {
	h    hash.Hash
	rows int
}

func newDigest() *digest { return &digest{h: sha256.New()} }

func (d *digest) add(r Row) error {
	d.rows++
	_, err := d.h.Write(r.line())
	return err
}

// sealHash chains a day to the seal before it: SHA-256 of the previous hash,
// the day, its row count and the digest of its rows.
func sealHash(prev []byte, day time.Time, rows int, sum []byte) []byte {
	h := sha256.New()
	h.Write(prev)
	h.Write([]byte(day.Format("2006-01-02")))
	_ = binary.Write(h, binary.BigEndian, int64(rows))
	h.Write(sum)
	return h.Sum(nil)
}

// SealStore is what sealing, verifying and purging need of the trail.
type SealStore interface {
	// EachRow calls f for every event that occurred in [from, to), in
	// (occurred_at, id) order.
	EachRow(ctx context.Context, from, to time.Time, f func(Row) error) error
	// FirstEventAt is when the oldest event occurred; nil for none.
	FirstEventAt(ctx context.Context) (*time.Time, error)
	// Seals are every seal, oldest day first.
	Seals(ctx context.Context) ([]Seal, error)
	// AddSeal writes s; ErrSealed when that day is sealed already.
	AddSeal(ctx context.Context, s Seal) error
	// Purges are every purge, oldest first.
	Purges(ctx context.Context) ([]Purge, error)
	// Purge deletes the events before p.BeforeDay through
	// purge_audit_events, and records p with how many it deleted and the
	// event ev(rows) — all in one transaction. It returns p as written.
	Purge(ctx context.Context, p Purge, ev func(rows int64) (Event, error)) (Purge, error)
}

// ErrSealed: the day has a seal already (another instance sealed it).
var ErrSealed = fmt.Errorf("day already sealed")

// Mismatch is the first thing Verify found wrong.
type Mismatch struct {
	Day time.Time `json:"day"`
	// Problem: rows (the count differs), hash (the events differ), chain (a
	// seal does not follow the one before), or gap (a day has no seal).
	Problem    string `json:"problem"`
	SealedRows int    `json:"sealed_rows"`
	FoundRows  int    `json:"found_rows"`
}

// Verification is what Verify found.
type Verification struct {
	CheckedAt time.Time `json:"checked_at"`
	OK        bool      `json:"ok"`
	// Days are the seals checked; Rows the events counted in them.
	Days int `json:"days"`
	Rows int `json:"rows"`
	// PurgedDays are sealed days whose events retention deleted: only their
	// seals' chain is checked.
	PurgedDays int        `json:"purged_days"`
	FirstDay   *time.Time `json:"first_day"`
	LastDay    *time.Time `json:"last_day"`
	// Unsealed counts the events after the last sealed day, not yet sealed.
	Unsealed int       `json:"unsealed"`
	Mismatch *Mismatch `json:"mismatch"`
}

// sealUntil is the first day that cannot be sealed yet at now: today, or
// yesterday within SealGrace of midnight.
func sealUntil(now time.Time) time.Time {
	return now.UTC().Add(-SealGrace).Truncate(Day)
}

// SealDays seals every day not sealed yet that has ended (plus SealGrace),
// from the day of the oldest event or after the last seal, and returns how
// many it sealed. A day with no events is sealed too, so the chain has no
// holes.
func (s *Service) SealDays(ctx context.Context) (int, error) {
	seals, err := s.seals.Seals(ctx)
	if err != nil {
		return 0, err
	}
	var day time.Time
	var prev []byte
	if n := len(seals); n > 0 {
		day, prev = seals[n-1].Day.Add(Day), seals[n-1].Hash
	} else {
		first, err := s.seals.FirstEventAt(ctx)
		if err != nil || first == nil {
			return 0, err
		}
		day = first.UTC().Truncate(Day)
	}
	until := sealUntil(s.now())
	sealed := 0
	for ; day.Before(until); day = day.Add(Day) {
		d := newDigest()
		if err := s.seals.EachRow(ctx, day, day.Add(Day), d.add); err != nil {
			return sealed, err
		}
		seal := Seal{Day: day, Rows: d.rows, PrevHash: prev, SealedAt: s.now()}
		seal.Hash = sealHash(prev, day, d.rows, d.h.Sum(nil))
		if err := s.seals.AddSeal(ctx, seal); err != nil {
			if err == ErrSealed {
				// Another instance got there first; carry on from what it wrote.
				return sealed, nil
			}
			return sealed, err
		}
		prev = seal.Hash
		sealed++
	}
	return sealed, nil
}

// Verify recomputes every seal from the events, oldest first, and checks the
// chain; days retention has purged are checked by their chain only. It
// stops at the first mismatch. The result is also kept as LastVerification.
func (s *Service) Verify(ctx context.Context) (Verification, error) {
	v := Verification{CheckedAt: s.now(), OK: true}
	seals, err := s.seals.Seals(ctx)
	if err != nil {
		return v, err
	}
	purges, err := s.seals.Purges(ctx)
	if err != nil {
		return v, err
	}
	var purgedBefore time.Time
	for _, p := range purges {
		if p.BeforeDay.After(purgedBefore) {
			purgedBefore = p.BeforeDay
		}
	}
	var prev []byte
	for i, seal := range seals {
		if i == 0 {
			first := seal.Day
			v.FirstDay = &first
		}
		fail := func(problem string, found int) {
			v.OK = false
			v.Mismatch = &Mismatch{Day: seal.Day, Problem: problem, SealedRows: seal.Rows, FoundRows: found}
		}
		switch {
		case i > 0 && !seal.Day.Equal(seals[i-1].Day.Add(Day)):
			fail("gap", 0)
		case !bytes.Equal(seal.PrevHash, prev):
			fail("chain", 0)
		}
		if !v.OK {
			break
		}
		v.Days++
		if seal.Day.Before(purgedBefore) {
			v.PurgedDays++
		} else {
			d := newDigest()
			if err := s.seals.EachRow(ctx, seal.Day, seal.Day.Add(Day), d.add); err != nil {
				return v, err
			}
			v.Rows += d.rows
			switch {
			case d.rows != seal.Rows:
				fail("rows", d.rows)
			case !bytes.Equal(sealHash(prev, seal.Day, d.rows, d.h.Sum(nil)), seal.Hash):
				fail("hash", d.rows)
			}
			if !v.OK {
				break
			}
		}
		prev = seal.Hash
		last := seal.Day
		v.LastDay = &last
	}
	if v.OK {
		from := time.Time{}
		if v.LastDay != nil {
			from = v.LastDay.Add(Day)
		}
		count := func(Row) error { v.Unsealed++; return nil }
		if err := s.seals.EachRow(ctx, from, s.now().Add(Day), count); err != nil {
			return v, err
		}
	}
	s.mu.Lock()
	s.lastVerification = &v
	s.mu.Unlock()
	return v, nil
}

// LastVerification is the latest Verify's result; nil before the first.
func (s *Service) LastVerification() *Verification {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastVerification
}

// PurgeExpired deletes the events older than the retention, whole sealed days
// only, and records the purge (audit_purges and an audit.purged event). It
// returns how many events it deleted; 0 when there were none to delete.
func (s *Service) PurgeExpired(ctx context.Context) (int64, error) {
	if s.retention <= 0 {
		return 0, nil
	}
	before := s.now().Add(-s.retention).UTC().Truncate(Day)
	// Never past what is sealed: a purged day must have been sealed first.
	seals, err := s.seals.Seals(ctx)
	if err != nil || len(seals) == 0 {
		return 0, err
	}
	if lastSealed := seals[len(seals)-1].Day.Add(Day); lastSealed.Before(before) {
		before = lastSealed
	}
	first, err := s.seals.FirstEventAt(ctx)
	if err != nil || first == nil || !first.Before(before) {
		return 0, err
	}
	p, err := s.seals.Purge(ctx, Purge{ID: s.newID(), BeforeDay: before, PurgedAt: s.now()}, func(rows int64) (Event, error) {
		return New(s.newID(), nil, EventPurged, EntityLog, s.newID(), s.now(), nil,
			map[string]any{"older_than": before.Format("2006-01-02"), "rows": rows})
	})
	return p.Rows, err
}
