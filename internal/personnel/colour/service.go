package colour

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/jpeg"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/aiusage"
)

// Make Colour Photo (AI) (FR-12, ADR 0007 decision 7): the grey portrait
// sent to the model under Settings → AI, its answer taken through the
// luminance lock, every call recorded in AI usage. Nothing is stored: the
// app saves the photo it is given back, with the person's consent.

// Provider makes the colour: OpenAI, or a test's fake.
type Provider interface {
	Colorize(ctx context.Context, e Edit, grey image.Image) (image.Image, aiusage.Result, error)
}

// SettingsSource is Settings → AI and its key (aiusage.SettingsService).
type SettingsSource interface {
	Settings(ctx context.Context) (aiusage.Settings, error)
	Key(ctx context.Context) (string, error)
}

// Runner records each call (aiusage.Service).
type Runner interface {
	Run(ctx context.Context, r aiusage.Request, call func(ctx context.Context) (aiusage.Result, error)) error
}

var (
	// ErrOff is colouring while Settings → AI's AI colour photos is off (409).
	ErrOff = errors.New("AI colour photos are off in Settings")
	// ErrNotPortrait is a portrait that is not a JPEG of at most 2 MB and 2400 px (415).
	ErrNotPortrait = errors.New("the portrait must be a JPEG of at most 2 MB and 2400 px")
	// ErrTooOften is a user colouring more than RateLimit portraits an hour (429).
	ErrTooOften = errors.New("too many colour photos in the last hour")
)

const (
	// MaxBytes and MaxSide bound the portrait sent.
	MaxBytes = 2 << 20
	MaxSide  = 2400
	// RateLimit is how many portraits a user may colour an hour.
	RateLimit = 20
)

type Service struct {
	settings SettingsSource
	runner   Runner
	provider Provider
	now      func() time.Time

	mu     sync.Mutex
	recent map[uuid.UUID][]time.Time
}

func NewService(settings SettingsSource, runner Runner, provider Provider) *Service {
	return &Service{settings: settings, runner: runner, provider: provider, now: time.Now, recent: map[uuid.UUID][]time.Time{}}
}

// allow counts a user's colouring against the hourly limit.
func (s *Service) allow(user uuid.UUID) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := s.now().Add(-time.Hour)
	kept := s.recent[user][:0]
	for _, t := range s.recent[user] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= RateLimit {
		s.recent[user] = kept
		return false
	}
	s.recent[user] = append(kept, s.now())
	return true
}

// Available is whether colouring is offered: AI colour photos on, and a key
// saved. The budget and the rate limit still refuse a call.
func (s *Service) Available(ctx context.Context) (bool, error) {
	cfg, err := s.settings.Settings(ctx)
	if err != nil {
		return false, err
	}
	return cfg.Enabled && cfg.Key != nil, nil
}

// Colorize colours a portrait (a JPEG) for employee, as actor, and answers a
// JPEG with the portrait's own lightness.
func (s *Service) Colorize(ctx context.Context, portrait []byte, employee, actor uuid.UUID) ([]byte, error) {
	if len(portrait) > MaxBytes {
		return nil, ErrNotPortrait
	}
	grey, format, err := image.Decode(bytes.NewReader(portrait))
	if err != nil || format != "jpeg" || grey.Bounds().Dx() > MaxSide || grey.Bounds().Dy() > MaxSide {
		return nil, ErrNotPortrait
	}
	cfg, err := s.settings.Settings(ctx)
	if err != nil {
		return nil, err
	}
	if !cfg.Enabled {
		return nil, ErrOff
	}
	key, err := s.settings.Key(ctx)
	if err != nil {
		return nil, err
	}
	if !s.allow(actor) {
		return nil, ErrTooOften
	}
	req := aiusage.Request{Operation: aiusage.PortraitColorize, Provider: aiusage.ProviderOpenAI, Model: cfg.Model, Budget: cfg.BudgetMicroUSD, UserID: actor}
	if employee != uuid.Nil {
		req.EmployeeID = &employee
	}
	if p, ok := cfg.Prices[cfg.Model]; ok {
		req.Prices = &p
	}
	var answer image.Image
	err = s.runner.Run(ctx, req, func(ctx context.Context) (aiusage.Result, error) {
		img, res, err := s.provider.Colorize(ctx, Edit{Key: key, Model: cfg.Model, Quality: cfg.Quality}, grey)
		answer = img
		return res, err
	})
	if err != nil {
		return nil, err
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, Lock(grey, answer), &jpeg.Options{Quality: 90}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}
