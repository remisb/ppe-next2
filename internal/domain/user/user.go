package user

import (
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	maxNameLen  = 200
	maxEmailLen = 254
	// bcrypt ignores input past 72 bytes; reject rather than silently truncate.
	minPasswordLen = 8
	maxPasswordLen = 72
)

// User is an account that can sign in. PasswordHash never leaves the service in
// a response: it is tagged json:"-".
type User struct {
	ID              uuid.UUID  `json:"id"`
	Email           string     `json:"email"`
	Name            string     `json:"name"`
	PasswordHash    string     `json:"-"`
	Roles           []string   `json:"roles"`
	IsActive        bool       `json:"is_active"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
	CreatedByUserID uuid.UUID  `json:"created_by_user_id"`
	UpdatedByUserID uuid.UUID  `json:"updated_by_user_id"`
	DeletedByUserID *uuid.UUID `json:"deleted_by_user_id,omitempty"`
}

// Deleted reports whether the user has been soft-deleted.
func (u User) Deleted() bool { return u.DeletedAt != nil }

// HasRole reports whether the user holds role r.
func (u User) HasRole(r string) bool {
	for _, have := range u.Roles {
		if have == r {
			return true
		}
	}
	return false
}

// CreateParams are the client-settable fields of a new user.
type CreateParams struct {
	Email    string
	Name     string
	Password string
	Roles    []string
}

func (p *CreateParams) Normalize() {
	p.Email = normalizeEmail(p.Email)
	p.Name = strings.TrimSpace(p.Name)
	p.Roles = normalizeRoles(p.Roles)
}

func (p *CreateParams) Validate() error {
	p.Normalize()
	if err := validateProfile(p.Email, p.Name, p.Roles); err != nil {
		return err
	}
	return validatePassword(p.Password)
}

// UpdateParams replace every mutable profile field; clients send full state.
// Passwords change through SetPassword/ChangePassword, never here.
type UpdateParams struct {
	Email    string
	Name     string
	Roles    []string
	IsActive bool
}

func (p *UpdateParams) Normalize() {
	p.Email = normalizeEmail(p.Email)
	p.Name = strings.TrimSpace(p.Name)
	p.Roles = normalizeRoles(p.Roles)
}

func (p *UpdateParams) Validate() error {
	p.Normalize()
	return validateProfile(p.Email, p.Name, p.Roles)
}

func normalizeEmail(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func validateProfile(email, name string, roles []string) error {
	switch {
	case email == "":
		return fieldError("email", "is required")
	case len(email) > maxEmailLen:
		return fieldError("email", "is too long")
	}
	// Require a bare address: "Name <a@b>" parses too, but is not what we store.
	if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email {
		return fieldError("email", "is not a valid address")
	}
	switch {
	case name == "":
		return fieldError("name", "is required")
	case len(name) > maxNameLen:
		return fieldError("name", "is too long")
	}
	if len(roles) == 0 {
		return fieldError("roles", "must contain at least one role")
	}
	for _, r := range roles {
		if !IsKnownRole(r) {
			return fieldError("roles", "contains unknown role "+r)
		}
	}
	return nil
}

func validatePassword(pw string) error {
	switch {
	case len(pw) < minPasswordLen:
		return fieldError("password", "must be at least 8 characters")
	case len(pw) > maxPasswordLen:
		return fieldError("password", "must be at most 72 bytes")
	}
	return nil
}
