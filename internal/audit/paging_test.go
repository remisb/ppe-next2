package audit

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

// A problem is the caller's own error, so a refused filter stays its package's ErrInvalid.
func TestPagingReportsThroughTheCallersError(t *testing.T) {
	errMine := errors.New("mine")
	mine := func(field, problem string) error { return errors.Join(errMine, errors.New(field+" "+problem)) }
	if n, err := PageLimit(0, mine); n != DefaultPageSize || err != nil {
		t.Errorf("PageLimit(0) = %d, %v", n, err)
	}
	if n, err := PageLimit(MaxPageSize, mine); n != MaxPageSize || err != nil {
		t.Errorf("PageLimit(max) = %d, %v", n, err)
	}
	for _, size := range []int{-1, MaxPageSize + 1} {
		if _, err := PageLimit(size, mine); !errors.Is(err, errMine) {
			t.Errorf("PageLimit(%d) = %v, want the caller's error", size, err)
		}
	}
	loc := time.FixedZone("Vilnius", 2*60*60)
	from, to, err := DayRange("2026-11-01", "2026-11-01", loc, mine)
	if err != nil || !from.Equal(time.Date(2026, 11, 1, 0, 0, 0, 0, loc)) || !to.Equal(time.Date(2026, 11, 2, 0, 0, 0, 0, loc)) {
		t.Errorf("DayRange = %v, %v, %v; want the day's start and the next day's", from, to, err)
	}
	if from, to, err := DayRange("", "", loc, mine); from != nil || to != nil || err != nil {
		t.Errorf("DayRange of nothing = %v, %v, %v", from, to, err)
	}
	for _, d := range [][2]string{{"1 Nov", ""}, {"", "2026-13-01"}, {"2026-11-02", "2026-11-01"}} {
		if _, _, err := DayRange(d[0], d[1], loc, mine); !errors.Is(err, errMine) {
			t.Errorf("DayRange(%q, %q) = %v, want the caller's error", d[0], d[1], err)
		}
	}
}

func TestNextPage(t *testing.T) {
	at := time.Date(2026, 11, 22, 10, 0, 0, 0, time.UTC)
	cursor := func(i int) Cursor { return Cursor{At: at.Add(-time.Duration(i) * time.Minute), ID: uuid.Nil} }
	if rows, next := NextPage[int](nil, 2, cursor); rows == nil || len(rows) != 0 || next != nil {
		t.Errorf("no rows = %v, %v; want an empty page and no next", rows, next)
	}
	if rows, next := NextPage([]int{1, 2}, 2, cursor); len(rows) != 2 || next != nil {
		t.Errorf("a full last page = %v, %v; want no next", rows, next)
	}
	rows, next := NextPage([]int{1, 2, 3}, 2, cursor)
	if len(rows) != 2 || next == nil || *next != cursor(2).String() {
		t.Errorf("one more than the page = %v, %v; want 2 rows and the second's cursor", rows, next)
	}
}
