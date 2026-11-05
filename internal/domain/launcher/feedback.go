package launcher

import (
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Feedback is what someone said about an app from its tile, with where they
// used it.
type Feedback struct {
	ID       uuid.UUID `json:"id"`
	AppID    uuid.UUID `json:"app_id"`
	UserID   uuid.UUID `json:"user_id"`
	UserName string    `json:"user_name"`
	Rating   string    `json:"rating"`
	Text     string    `json:"text"`
	Device   string    `json:"device"`
	Language string    `json:"language"`
	// Version is the published version the sender's tile opened (migration
	// 0045); nil for an app with no versions.
	Version *string `json:"version"`
	// CreatedAt is when it was sent.
	CreatedAt time.Time `json:"created_at"`
}

var (
	Ratings   = []string{"works", "confusing", "broken"}
	Devices   = []string{"phone", "tablet", "desktop"}
	Languages = []string{"en", "lt", "ru"}
)

const maxFeedback = 2000

type FeedbackParams struct {
	App      string
	Rating   string
	Text     string
	Device   string
	Language string
}

func (p *FeedbackParams) Normalize() {
	p.App = strings.TrimSpace(strings.ToLower(p.App))
	p.Text = strings.TrimSpace(p.Text)
}

func (p FeedbackParams) Validate() error {
	if !slices.Contains(Ratings, p.Rating) {
		return fieldError("rating", "must be works, confusing or broken")
	}
	if utf8.RuneCountInString(p.Text) > maxFeedback {
		return fieldError("text", "is longer than 2000 characters")
	}
	if !slices.Contains(Devices, p.Device) {
		return fieldError("device", "must be phone, tablet or desktop")
	}
	if !slices.Contains(Languages, p.Language) {
		return fieldError("language", "must be en, lt or ru")
	}
	return nil
}
