// Package settings holds the organisation's settings that administrators
// change in the app, one set for the whole organisation: the supplier's
// WhatsApp group, which Copy for WhatsApp opens for the order message, and the
// SIM card providers, which Add SIM offers, the default one chosen. Settings
// fixed at deployment (timezone, currency) stay in config.
package settings

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	maxChatNameLen = 100
	// maxProviderLen is a SIM card's provider's limit (asset.maxTextLen).
	maxProviderLen = 100
	maxProviders   = 50
)

// chatHost is where WhatsApp group invite links live.
const chatHost = "chat.whatsapp.com"

// inviteCode is the code in an invite link's path.
var inviteCode = regexp.MustCompile(`^[A-Za-z0-9]{10,40}$`)

// Settings is the organisation's one set. The zero value is the defaults,
// what a database with no settings row reads as.
type Settings struct {
	SupplierChat SupplierChat
	// SIMProviders are the providers Add SIM offers, in the administrator's
	// order; never nil once read.
	SIMProviders []string
	// DefaultSIMProvider is the one of them Add SIM chooses for a new card;
	// empty when there is none.
	DefaultSIMProvider string
	UpdatedAt          time.Time
	UpdatedByUserID    uuid.UUID
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

// SIMProvidersParams replace the SIM card providers: the list, and the one of
// them Add SIM chooses first, or empty for none.
type SIMProvidersParams struct {
	Providers []string
	Default   string
}

// Normalize trims each provider, as an asset's provider is trimmed so the
// list reads the same as the cards that use it, and drops empty ones. A
// default that names a listed provider in another case takes the list's spelling.
func (p *SIMProvidersParams) Normalize() {
	list := make([]string, 0, len(p.Providers))
	for _, name := range p.Providers {
		if name = strings.TrimSpace(name); name != "" {
			list = append(list, name)
		}
	}
	p.Providers = list
	p.Default = strings.TrimSpace(p.Default)
	for _, name := range list {
		if strings.EqualFold(name, p.Default) {
			p.Default = name
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
	for _, name := range p.Providers {
		if len(name) > maxProviderLen {
			return fieldError("provider", "is too long")
		}
		key := strings.ToLower(name)
		if seen[key] {
			return fieldError("providers", fmt.Sprintf("list %s twice", name))
		}
		seen[key] = true
	}
	if p.Default != "" && !seen[strings.ToLower(p.Default)] {
		return fieldError("default", "must be one of the providers")
	}
	return nil
}
