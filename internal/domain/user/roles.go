package user

import (
	"slices"
	"strings"
)

// Roles a user can hold. Stored lowercase in users.roles and carried verbatim in
// the JWT roles claim; the migration's CHECK constraint lists the same values.
const (
	RoleAdmin    = "admin"
	RoleManager  = "manager"
	RoleEmployee = "employee"
)

var knownRoles = []string{RoleAdmin, RoleManager, RoleEmployee}

// KnownRoles returns every valid role in a stable order.
func KnownRoles() []string { return slices.Clone(knownRoles) }

// IsKnownRole reports whether r is a valid role name.
func IsKnownRole(r string) bool { return slices.Contains(knownRoles, r) }

// normalizeRoles lowercases, trims, de-duplicates and sorts roles so that equal
// role sets compare and store identically.
func normalizeRoles(roles []string) []string {
	out := make([]string, 0, len(roles))
	for _, r := range roles {
		r = strings.ToLower(strings.TrimSpace(r))
		if r != "" && !slices.Contains(out, r) {
			out = append(out, r)
		}
	}
	slices.Sort(out)
	return out
}
