package role

import (
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	maxNameLen        = 100
	maxDescriptionLen = 500
)

// Role is a named bundle of permissions that users hold. A built-in role has
// a Key and no creating actor; Administrator, the built-in admin, is Locked.
type Role struct {
	ID          uuid.UUID    `json:"id"`
	Key         *string      `json:"key"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Permissions []Permission `json:"permissions"`
	// Locked is derived: Administrator cannot be changed or deleted.
	Locked bool `json:"locked"`
	// UserCount is derived: the live users who hold the role.
	UserCount       int        `json:"user_count"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
	CreatedByUserID *uuid.UUID `json:"created_by_user_id"`
	UpdatedByUserID *uuid.UUID `json:"updated_by_user_id"`
	DeletedByUserID *uuid.UUID `json:"deleted_by_user_id,omitempty"`
}

// Builtin reports whether the role is one every installation has.
func (r Role) Builtin() bool { return r.Key != nil }

// Deleted reports whether the role has been soft-deleted.
func (r Role) Deleted() bool { return r.DeletedAt != nil }

// Grants reports whether the role allows p.
func (r Role) Grants(p Permission) bool { return slices.Contains(r.Permissions, p) }

// Params are the client-settable fields of a role, for adding and changing it
// (full replace).
type Params struct {
	Name        string
	Description string
	Permissions []string
}

func (p *Params) Normalize() {
	p.Name = strings.TrimSpace(p.Name)
	p.Description = strings.TrimSpace(p.Description)
	keys := make([]string, 0, len(p.Permissions))
	for _, k := range p.Permissions {
		if k = strings.TrimSpace(k); k != "" && !slices.Contains(keys, k) {
			keys = append(keys, k)
		}
	}
	p.Permissions = keys
}

// Validate checks the fields and returns the permissions in catalogue order.
// Every key must be known, and a permission's requirements must be granted
// with it (managing users needs seeing them).
func (p *Params) Validate() ([]Permission, error) {
	p.Normalize()
	switch {
	case p.Name == "":
		return nil, fieldError("name", "is required")
	case utf8.RuneCountInString(p.Name) > maxNameLen:
		return nil, fieldError("name", "is too long")
	case utf8.RuneCountInString(p.Description) > maxDescriptionLen:
		return nil, fieldError("description", "is too long")
	}
	for _, k := range p.Permissions {
		if !IsKnown(k) {
			return nil, fieldError("permissions", "contains unknown permission "+k)
		}
	}
	perms := Known(p.Permissions)
	if missing := MissingRequirements(perms); len(missing) > 0 {
		return nil, fieldError("permissions", "need "+strings.Join(missing, ", "))
	}
	return perms, nil
}

// MissingRequirements lists, as "a needs b", each permission in perms whose
// requirement is not in perms.
func MissingRequirements(perms []Permission) []string {
	var out []string
	for _, info := range catalogue {
		if !slices.Contains(perms, info.Key) {
			continue
		}
		for _, r := range info.Requires {
			if !slices.Contains(perms, r) {
				out = append(out, string(info.Key)+" needs "+string(r))
			}
		}
	}
	return out
}

// MayGrant reports whether someone holding mine may give or take away perms:
// whoever manages roles may grant any permission, since they define what the
// roles hold; anyone else only permissions they hold themselves.
func MayGrant(perms, mine []Permission) bool {
	return slices.Contains(mine, RolesManage) || Subset(perms, mine)
}

// Subset reports whether every permission in perms is in of.
func Subset(perms, of []Permission) bool {
	for _, p := range perms {
		if !slices.Contains(of, p) {
			return false
		}
	}
	return true
}
