package audit

import (
	"fmt"
	"time"
)

// The lists paged by Cursor (the Audit log, the security log and System's
// error list) share these. A problem is reported through the caller's
// invalid, its own fieldError, so a refused filter stays that package's
// ErrInvalid.

// PageLimit is how many rows a page of size shows: DefaultPageSize for 0,
// else 1 to MaxPageSize.
func PageLimit(size int, invalid func(field, problem string) error) (int, error) {
	switch {
	case size < 0 || size > MaxPageSize:
		return 0, invalid("page_size", fmt.Sprintf("must be between 1 and %d", MaxPageSize))
	case size == 0:
		return DefaultPageSize, nil
	}
	return size, nil
}

// DayRange turns from and to, inclusive calendar days written YYYY-MM-DD
// (either may be empty), into instants in loc: start at the beginning of
// from, end at the beginning of the day after to.
func DayRange(from, to string, loc *time.Location, invalid func(field, problem string) error) (start, end *time.Time, err error) {
	if from != "" {
		d, err := time.ParseInLocation(dateLayout, from, loc)
		if err != nil {
			return nil, nil, invalid("from", "must be a date YYYY-MM-DD")
		}
		start = &d
	}
	if to != "" {
		d, err := time.ParseInLocation(dateLayout, to, loc)
		if err != nil {
			return nil, nil, invalid("to", "must be a date YYYY-MM-DD")
		}
		next := d.AddDate(0, 0, 1)
		end = &next
	}
	if start != nil && end != nil && !start.Before(*end) {
		return nil, nil, invalid("to", "must not be before from")
	}
	return start, end, nil
}

// NextPage cuts rows, read with one more than limit to tell whether another
// page follows, to the page, and gives the cursor that continues after it (nil
// on the last page). The page is never nil.
func NextPage[T any](rows []T, limit int, at func(T) Cursor) ([]T, *string) {
	var next *string
	if len(rows) > limit {
		rows = rows[:limit]
		c := at(rows[limit-1]).String()
		next = &c
	}
	if rows == nil {
		rows = make([]T, 0)
	}
	return rows, next
}
