// Package settings holds the organisation's settings that administrators
// change in the app, one set for the whole organisation: the supplier's
// WhatsApp group, which Copy for WhatsApp opens for the order message, and the
// default SIM card provider, which Add SIM Card fills in. Settings fixed at
// deployment (timezone, currency) stay in config.
package settings

import (
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
)

// chatHost is where WhatsApp group invite links live.
const chatHost = "chat.whatsapp.com"

// inviteCode is the code in an invite link's path.
var inviteCode = regexp.MustCompile(`^[A-Za-z0-9]{10,40}$`)

// Settings is the organisation's one set. The zero value is the defaults,
// what a database with no settings row reads as.
type Settings struct {
	SupplierChat SupplierChat
	// DefaultSIMProvider is the provider Add SIM Card fills in for a new
	// card; empty when there is none.
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

// NormalizeProvider trims a provider as an asset's provider is trimmed, so the
// default reads the same as the cards that use it.
func NormalizeProvider(p string) string { return strings.TrimSpace(p) }

func validateProvider(p string) error {
	if len(p) > maxProviderLen {
		return fieldError("provider", "is too long")
	}
	return nil
}
