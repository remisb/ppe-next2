package asset

import (
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// SortKey orders the register.
type SortKey string

const (
	SortInventory SortKey = "inventory" // the default
	SortStatus    SortKey = "status"
	SortHolder    SortKey = "holder"
	SortGiven     SortKey = "given"
	SortName      SortKey = "name" // equipment
)

const (
	defaultPageSize = 50
	maxPageSize     = 100
	maxPage         = 1_000_000 // keeps the offset far from overflowing
	numberLimit     = 20
)

// ListParams is a register query as the user states it. Empty fields do not
// filter.
type ListParams struct {
	Kind        string // SIM or EQUIPMENT, required
	Q           string // SIM, phone or inventory number, or the holder's name
	Location    string // OFFICE, WITH_EMPLOYEE or UNKNOWN
	Held        string // "true" keeps the assets someone holds, whereabouts known or not
	EmployeeID  *uuid.UUID
	Provider    string
	Category    string // an equipment category
	Status      string // a connection status
	NotReturned string // "true" keeps the assets marked Not Returned
	Sort        string
	Dir         string // asc or desc; "" means asc
	Page        string
	PageSize    string
}

// ListFilter is a checked register query for the repository.
type ListFilter struct {
	Kind        Kind
	Q           string
	Location    *Location
	Held        bool
	EmployeeID  *uuid.UUID
	Provider    string
	Category    *Category
	Status      *Status
	NotReturned bool
	Sort        SortKey
	Desc        bool
	Limit       int
	Offset      int
}

// ListResult is one page of the register.
type ListResult struct {
	Assets   []View `json:"assets"`
	Page     int    `json:"page"`
	PageSize int    `json:"page_size"`
	Total    int    `json:"total"`
}

// Summary is the register's tiles (§3). They overlap and are never summed:
// an asset marked Not Returned is also with an employee.
type Summary struct {
	Total         int `json:"total"`
	InOffice      int `json:"in_office"`
	WithEmployees int `json:"with_employees"`
	NotReturned   int `json:"not_returned"`
	// Providers are the providers of the kind's assets, for the register's filter.
	Providers []string `json:"providers"`
}

func (p ListParams) filter() (ListFilter, int, int, error) {
	f := ListFilter{Kind: Kind(p.Kind), Q: strings.TrimSpace(p.Q), EmployeeID: p.EmployeeID, Provider: strings.TrimSpace(p.Provider)}
	if !f.Kind.valid() {
		return ListFilter{}, 0, 0, fieldError("kind", "must be SIM or EQUIPMENT")
	}
	if p.Location != "" {
		l := Location(p.Location)
		if l != LocationOffice && l != LocationWithEmployee && l != LocationUnknown {
			return ListFilter{}, 0, 0, fieldError("location", "must be OFFICE, WITH_EMPLOYEE or UNKNOWN")
		}
		f.Location = &l
	}
	if p.Category != "" {
		c := Category(p.Category)
		if prefixes[c] == "" {
			return ListFilter{}, 0, 0, fieldError("category", "must be COMPUTER, PHONE, EXTERNAL_DRIVE, FURNITURE or OTHER")
		}
		f.Category = &c
	}
	if p.Status != "" {
		s := Status(p.Status)
		if !s.valid() {
			return ListFilter{}, 0, 0, fieldError("status", "must be NOT_ACTIVATED, ACTIVE or BLOCKED")
		}
		f.Status = &s
	}
	switch p.Held {
	case "":
	case "true":
		f.Held = true
	default:
		return ListFilter{}, 0, 0, fieldError("held", "must be true")
	}
	switch p.NotReturned {
	case "":
	case "true":
		f.NotReturned = true
	default:
		return ListFilter{}, 0, 0, fieldError("not_returned", "must be true")
	}
	switch SortKey(p.Sort) {
	case "", SortInventory:
		f.Sort = SortInventory
	case SortStatus, SortHolder, SortGiven, SortName:
		f.Sort = SortKey(p.Sort)
	default:
		return ListFilter{}, 0, 0, fieldError("sort", "must be inventory, name, status, holder or given")
	}
	switch p.Dir {
	case "", "asc":
	case "desc":
		f.Desc = true
	default:
		return ListFilter{}, 0, 0, fieldError("dir", "must be asc or desc")
	}
	page, err := positive(p.Page, 1, "page")
	if err != nil {
		return ListFilter{}, 0, 0, err
	}
	size, err := positive(p.PageSize, defaultPageSize, "page_size")
	if err != nil {
		return ListFilter{}, 0, 0, err
	}
	if size > maxPageSize {
		return ListFilter{}, 0, 0, fieldError("page_size", "must be at most 100")
	}
	if page > maxPage {
		return ListFilter{}, 0, 0, fieldError("page", "must be at most 1000000")
	}
	f.Limit, f.Offset = size, (page-1)*size
	return f, page, size, nil
}

func positive(s string, def int, field string) (int, error) {
	if s == "" {
		return def, nil
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return 0, fieldError(field, "must be a positive whole number")
	}
	return n, nil
}
