package aiusage

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
)

// Settings → AI (docs/specs/ai-usage-service.md): whether AI colour photos are
// on, the model and its quality, the price table, the monthly budget, and the
// OpenAI key, sealed, of which only the last four characters and who set it
// are ever shown.

// Audit events, on the entity "settings" (the Audit log's Settings area).
const (
	EventSettingsChanged = "settings.ai_changed"
	EventKeySet          = "settings.ai_key_set"
	EventKeyRemoved      = "settings.ai_key_removed"
	settingsEntity       = "settings"
)

// settingsEntityID is the organisation's settings in audit events, the same
// id internal/domain/settings records its own changes under.
var settingsEntityID = uuid.NewSHA1(uuid.NameSpaceURL, []byte("https://workwear.gavort.nl/settings"))

// The qualities OpenAI's image models take: the main driver of a call's cost.
var qualities = map[string]bool{"low": true, "medium": true, "high": true}

// The provider every model here is of, for the ledger.
const ProviderOpenAI = "openai"

// KeyInfo is what is shown of the saved key: never the key.
type KeyInfo struct {
	Last4   string    `json:"last4"`
	SetAt   time.Time `json:"set_at"`
	SetByID uuid.UUID `json:"set_by_user_id"`
}

// Settings are Settings → AI as everyone allowed to see them sees them.
type Settings struct {
	Enabled        bool              `json:"enabled"`
	Model          string            `json:"model"`
	Quality        string            `json:"quality"`
	Prices         map[string]Prices `json:"prices"`
	BudgetMicroUSD *int64            `json:"budget_micro_usd"`
	Key            *KeyInfo          `json:"key"`
}

// SettingsRow is the stored row: the settings and the sealed key.
type SettingsRow struct {
	Settings
	SealedKey []byte
	KeyID     int16
}

// DefaultSettings are the settings before an administrator changes any.
func DefaultSettings() Settings {
	return Settings{Model: "gpt-image-2", Quality: "medium", Prices: maps.Clone(DefaultPrices)}
}

// SettingsInput is what Settings → AI changes; the key has its own calls.
type SettingsInput struct {
	Enabled        bool
	Model          string
	Quality        string
	Prices         map[string]Prices
	BudgetMicroUSD *int64
}

var (
	ErrInvalid = errors.New("invalid AI settings")
	// ErrNoKey is colouring without a saved OpenAI key, or removing none.
	ErrNoKey = errors.New("no OpenAI key is saved")
	// ErrNoSecretsKey is saving a key without API_SECRETS_KEY to seal it (503).
	ErrNoSecretsKey = errors.New("the server has no API_SECRETS_KEY to seal the key with")
	// ErrKeyUnopenable is a saved key that does not open (another API_SECRETS_KEY).
	ErrKeyUnopenable = errors.New("the saved OpenAI key does not open")
)

func fieldError(field, problem string) error {
	return fmt.Errorf("%w: %s %s", ErrInvalid, field, problem)
}

var modelName = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,63}$`)

// Validate checks the input as the database would, in words.
func (in *SettingsInput) Validate() error {
	in.Model = strings.TrimSpace(in.Model)
	switch {
	case !modelName.MatchString(in.Model):
		return fieldError("model", "is not a model's name")
	case !qualities[in.Quality]:
		return fieldError("quality", "must be low, medium or high")
	case in.BudgetMicroUSD != nil && *in.BudgetMicroUSD < 0:
		return fieldError("budget", "cannot be negative")
	}
	for model, p := range in.Prices {
		if !modelName.MatchString(model) {
			return fieldError("prices", "name an unknown model")
		}
		if p.InputText < 0 || p.InputImage < 0 || p.OutputText < 0 || p.OutputImage < 0 || p.InputText > 1e4 || p.InputImage > 1e4 || p.OutputText > 1e4 || p.OutputImage > 1e4 {
			return fieldError("prices", "must be from 0 to 10 000 dollars a million tokens")
		}
	}
	return nil
}

// Sealer is API_SECRETS_KEY's keyring (a sealbox.Keyring).
type Sealer interface {
	Seal(plain, context []byte) (sealed []byte, keyID int16, err error)
	Open(sealed []byte, keyID int16, context []byte) ([]byte, error)
}

// keyContext binds the sealed key to what it is, so a sealed value from elsewhere does not open as it.
var keyContext = []byte("ppe.settings.openai_key.v1")

// SettingsStore keeps Settings → AI, one row at most.
type SettingsStore interface {
	// Settings is the row, and false when there is none yet.
	Settings(ctx context.Context) (SettingsRow, bool, error)
	// UpdateSettings locks the row (made from mutate's first answer when there
	// is none) and writes what mutate makes of it, with the events.
	UpdateSettings(ctx context.Context, mutate func(cur SettingsRow) (SettingsRow, []audit.Event, error)) error
}

// SettingsService is Settings → AI.
type SettingsService struct {
	store  SettingsStore
	sealer Sealer
	now    func() time.Time
	newID  func() uuid.UUID
}

// NewSettingsService: sealer may be nil (no API_SECRETS_KEY): then no key can be saved or used.
func NewSettingsService(store SettingsStore, sealer Sealer) *SettingsService {
	return &SettingsService{store: store, sealer: sealer, now: func() time.Time { return time.Now().UTC().Truncate(time.Microsecond) }, newID: uuid.New}
}

// Settings are the saved settings, the defaults where none are saved.
func (s *SettingsService) Settings(ctx context.Context) (Settings, error) {
	row, found, err := s.store.Settings(ctx)
	if err != nil || !found {
		return DefaultSettings(), err
	}
	return row.Settings, nil
}

// CanSealKeys is whether a key can be saved here (API_SECRETS_KEY is set).
func (s *SettingsService) CanSealKeys() bool { return s.sealer != nil }

func (s *SettingsService) event(actor uuid.UUID, name string, before, after any) (audit.Event, error) {
	return audit.New(s.newID(), &actor, name, settingsEntity, settingsEntityID, s.now(), before, after)
}

// shown is what an event says of the settings: never the key.
func shown(st Settings) map[string]any {
	return map[string]any{"enabled": st.Enabled, "model": st.Model, "quality": st.Quality, "prices": st.Prices, "budget_micro_usd": st.BudgetMicroUSD}
}

func current(row SettingsRow, found bool) SettingsRow {
	if found {
		return row
	}
	return SettingsRow{Settings: DefaultSettings()}
}

// Update changes the settings, recording settings.ai_changed with what
// changed; the key stays as it is.
func (s *SettingsService) Update(ctx context.Context, in SettingsInput, actor uuid.UUID) (Settings, error) {
	if actor == uuid.Nil {
		return Settings{}, fieldError("actor", "is required")
	}
	if err := in.Validate(); err != nil {
		return Settings{}, err
	}
	var out Settings
	err := s.store.UpdateSettings(ctx, func(cur SettingsRow) (SettingsRow, []audit.Event, error) {
		next := cur
		next.Enabled, next.Model, next.Quality, next.BudgetMicroUSD = in.Enabled, in.Model, in.Quality, in.BudgetMicroUSD
		next.Prices = maps.Clone(in.Prices)
		if next.Prices == nil {
			next.Prices = map[string]Prices{}
		}
		out = next.Settings
		ev, err := s.event(actor, EventSettingsChanged, shown(cur.Settings), shown(next.Settings))
		return next, []audit.Event{ev}, err
	})
	return out, err
}

// SetKey seals and saves the OpenAI key, recording settings.ai_key_set with
// its last four characters only. Checking it with OpenAI is the caller's.
func (s *SettingsService) SetKey(ctx context.Context, key string, actor uuid.UUID) (Settings, error) {
	key = strings.TrimSpace(key)
	if actor == uuid.Nil {
		return Settings{}, fieldError("actor", "is required")
	}
	if len(key) < 20 || len(key) > 300 || strings.ContainsAny(key, " \t\r\n") {
		return Settings{}, fieldError("key", "is not an OpenAI API key")
	}
	if s.sealer == nil {
		return Settings{}, ErrNoSecretsKey
	}
	sealed, keyID, err := s.sealer.Seal([]byte(key), keyContext)
	if err != nil {
		return Settings{}, err
	}
	now := s.now()
	var out Settings
	err = s.store.UpdateSettings(ctx, func(cur SettingsRow) (SettingsRow, []audit.Event, error) {
		next := cur
		next.SealedKey, next.KeyID = sealed, keyID
		next.Key = &KeyInfo{Last4: key[len(key)-4:], SetAt: now, SetByID: actor}
		out = next.Settings
		before := map[string]any{"key": nil}
		if cur.Key != nil {
			before["key"] = "…" + cur.Key.Last4
		}
		ev, err := s.event(actor, EventKeySet, before, map[string]any{"key": "…" + next.Key.Last4})
		return next, []audit.Event{ev}, err
	})
	return out, err
}

// RemoveKey forgets the key; colouring stops until another is saved.
func (s *SettingsService) RemoveKey(ctx context.Context, actor uuid.UUID) (Settings, error) {
	if actor == uuid.Nil {
		return Settings{}, fieldError("actor", "is required")
	}
	var out Settings
	err := s.store.UpdateSettings(ctx, func(cur SettingsRow) (SettingsRow, []audit.Event, error) {
		if cur.Key == nil {
			return cur, nil, ErrNoKey
		}
		next := cur
		next.SealedKey, next.KeyID, next.Key = nil, 0, nil
		out = next.Settings
		ev, err := s.event(actor, EventKeyRemoved, map[string]any{"key": "…" + cur.Key.Last4}, nil)
		return next, []audit.Event{ev}, err
	})
	return out, err
}

// Key is the saved key, opened, for the one call that uses it; never for a route.
func (s *SettingsService) Key(ctx context.Context) (string, error) {
	row, found, err := s.store.Settings(ctx)
	if err != nil {
		return "", err
	}
	if !found || row.Key == nil {
		return "", ErrNoKey
	}
	if s.sealer == nil {
		return "", ErrNoSecretsKey
	}
	plain, err := s.sealer.Open(row.SealedKey, row.KeyID, keyContext)
	if err != nil {
		return "", ErrKeyUnopenable
	}
	return string(plain), nil
}
