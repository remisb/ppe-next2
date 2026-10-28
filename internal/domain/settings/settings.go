// Package settings holds the organisation's settings that administrators
// change in the app, one set for the whole organisation: the company's name,
// which mail templates use; the supplier's WhatsApp group, which Copy for
// WhatsApp opens for the order message; and the SIM providers, which Add SIM
// offers, the default one chosen, with the Non-return Value it fills in, each
// with the e-mail address its activation and blocking emails go to and the
// plan Add SIM and Give SIM fill in. Settings fixed at deployment (timezone,
// currency) stay in config.
package settings

import (
	"fmt"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	maxChatNameLen    = 100
	maxCompanyNameLen = 200
	// maxEmailLen is an e-mail address's limit (RFC 5321's path).
	maxEmailLen = 254
	// maxProviderLen is a SIM card's provider's limit (asset.maxTextLen).
	maxProviderLen = 100
	maxProviders   = 50
	// maxPlanLen is a SIM card's plan's limit (asset.maxTextLen).
	maxPlanLen = 100
	// maxValueCents is an asset's Non-return Value's limit (asset.maxValueCents).
	maxValueCents = 100_000_000_00
)

// chatHost is where WhatsApp group invite links live.
const chatHost = "chat.whatsapp.com"

// inviteCode is the code in an invite link's path.
var inviteCode = regexp.MustCompile(`^[A-Za-z0-9]{10,40}$`)

// Settings is the organisation's one set. The zero value is the defaults,
// what a database with no settings row reads as.
type Settings struct {
	// CompanyName is the organisation's name as mail templates write it
	// ({{company.name}}); empty when not set.
	CompanyName  string
	SupplierChat SupplierChat
	// SIMProviders are the providers Add SIM offers, in the administrator's
	// order; never nil once read.
	SIMProviders []SIMProvider
	// DefaultSIMProvider is the name of the one of them Add SIM chooses for a
	// new card; empty when there is none.
	DefaultSIMProvider string
	// DefaultSIMNonReturnValueCents is the Non-return Value Add SIM fills in
	// for a new card; nil when there is none.
	DefaultSIMNonReturnValueCents *int64
	UpdatedAt                     time.Time
	UpdatedByUserID               uuid.UUID
}

// SIMProvider is a SIM card provider listed on Settings: its name, as cards
// record it, the address its activation and blocking emails go to, and the
// plan Add SIM fills in for a new card of it and Give SIM for one of its
// cards that has none. Email and DefaultPlan are empty when not set.
type SIMProvider struct {
	Name        string `json:"name"`
	Email       string `json:"email"`
	DefaultPlan string `json:"default_plan"`
}

// Provider returns the listed provider of that name, whatever its case.
func (s Settings) Provider(name string) (SIMProvider, bool) {
	name = strings.TrimSpace(name)
	for _, p := range s.SIMProviders {
		if name != "" && strings.EqualFold(p.Name, name) {
			return p, true
		}
	}
	return SIMProvider{}, false
}

// ProviderNames lists the providers' names in order.
func (s Settings) ProviderNames() []string {
	names := make([]string, len(s.SIMProviders))
	for i, p := range s.SIMProviders {
		names[i] = p.Name
	}
	return names
}

// CompanyParams set the company's name, or empty to clear it.
type CompanyParams struct {
	Name string
}

func (p *CompanyParams) Normalize() { p.Name = strings.Join(strings.Fields(p.Name), " ") }

func (p *CompanyParams) Validate() error {
	p.Normalize()
	if len(p.Name) > maxCompanyNameLen {
		return fieldError("name", "is too long")
	}
	return nil
}

// SupplierChat is the supplier's WhatsApp group. WhatsApp has no link that
// opens a group with a message typed in, so the app copies the message and
// opens the group by its invite link, and staff paste it there. Empty Link:
// not set, and WhatsApp opens with the message for the user to send anywhere.
type SupplierChat struct {
	Name string `json:"name"`
	Link string `json:"link"`
}

func (c SupplierChat) Set() bool { return c.Link != "" }

// SupplierChatParams are the client-settable fields: both set, or both empty
// to clear the chat. The name is what staff see ("Open Superman Rubai Group").
type SupplierChatParams struct {
	Name string
	Link string
}

// Normalize trims both fields and reduces a valid invite link to
// https://chat.whatsapp.com/<code>, dropping what WhatsApp appends when the
// link is copied (?mode=…). An invalid link is left for Validate to name.
func (p *SupplierChatParams) Normalize() {
	p.Name = strings.Join(strings.Fields(p.Name), " ")
	p.Link = strings.TrimSpace(p.Link)
	if code, ok := parseInvite(p.Link); ok {
		p.Link = "https://" + chatHost + "/" + code
	}
}

func (p *SupplierChatParams) Validate() error {
	p.Normalize()
	switch {
	case len(p.Name) > maxChatNameLen:
		return fieldError("name", "is too long")
	case p.Link == "" && p.Name != "":
		return fieldError("link", "is required with a name")
	case p.Link != "" && p.Name == "":
		return fieldError("name", "is required with a link")
	case p.Link != "":
		if _, ok := parseInvite(p.Link); !ok {
			return fieldError("link", "must be a WhatsApp group invite link (https://chat.whatsapp.com/…)")
		}
	}
	return nil
}

// parseInvite returns the code of a WhatsApp group invite link.
func parseInvite(link string) (string, bool) {
	u, err := url.Parse(link)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || !strings.EqualFold(u.Host, chatHost) || u.User != nil {
		return "", false
	}
	code := strings.Trim(u.Path, "/")
	if !inviteCode.MatchString(code) {
		return "", false
	}
	return code, true
}

// SIMProvidersParams replace the SIM providers: the list, each with its
// e-mail and plan, the name of the one Add SIM chooses first, or empty for
// none, and the Non-return Value it fills in, or nil for none.
type SIMProvidersParams struct {
	Providers                  []SIMProvider
	Default                    string
	DefaultNonReturnValueCents *int64
}

// Normalize trims each provider's fields, its name as an asset's provider is
// trimmed so the list reads the same as the cards that use it, and drops the
// ones without a name. A default that names a listed provider in another case
// takes the list's spelling.
func (p *SIMProvidersParams) Normalize() {
	list := make([]SIMProvider, 0, len(p.Providers))
	for _, sp := range p.Providers {
		sp = SIMProvider{Name: strings.TrimSpace(sp.Name), Email: strings.TrimSpace(sp.Email), DefaultPlan: strings.TrimSpace(sp.DefaultPlan)}
		if sp.Name != "" {
			list = append(list, sp)
		}
	}
	p.Providers = list
	p.Default = strings.TrimSpace(p.Default)
	for _, sp := range list {
		if strings.EqualFold(sp.Name, p.Default) {
			p.Default = sp.Name
			break
		}
	}
}

func (p *SIMProvidersParams) Validate() error {
	p.Normalize()
	if len(p.Providers) > maxProviders {
		return fieldError("providers", fmt.Sprintf("may list at most %d", maxProviders))
	}
	seen := make(map[string]bool, len(p.Providers))
	for _, sp := range p.Providers {
		if len(sp.Name) > maxProviderLen {
			return fieldError("provider", "is too long")
		}
		key := strings.ToLower(sp.Name)
		if seen[key] {
			return fieldError("providers", fmt.Sprintf("list %s twice", sp.Name))
		}
		seen[key] = true
		if sp.Email != "" && !validEmail(sp.Email) {
			return fieldError("email", fmt.Sprintf("of %s must be one e-mail address, such as sim@provider.lt", sp.Name))
		}
		if len(sp.DefaultPlan) > maxPlanLen {
			return fieldError("default_plan", fmt.Sprintf("of %s is too long", sp.Name))
		}
	}
	if p.Default != "" && !seen[strings.ToLower(p.Default)] {
		return fieldError("default", "must be one of the providers")
	}
	if v := p.DefaultNonReturnValueCents; v != nil && (*v < 0 || *v > maxValueCents) {
		return fieldError("default_non_return_value_cents", "must be between 0 and 10000000000")
	}
	return nil
}

// validEmail tells whether s is one bare address (no name, no list) with a
// domain that has a dot, which is all a copied e-mail needs.
func validEmail(s string) bool {
	if len(s) > maxEmailLen {
		return false
	}
	a, err := mail.ParseAddress(s)
	if err != nil || a.Address != s || a.Name != "" {
		return false
	}
	at := strings.LastIndexByte(s, '@')
	return at > 0 && strings.Contains(s[at+1:], ".")
}
