package aiusage

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/sealbox"
)

type memSettings struct {
	row    SettingsRow
	found  bool
	events []audit.Event
}

func (m *memSettings) Settings(context.Context) (SettingsRow, bool, error) {
	return m.row, m.found, nil
}
func (m *memSettings) UpdateSettings(_ context.Context, mutate func(SettingsRow) (SettingsRow, []audit.Event, error)) error {
	next, evs, err := mutate(current(m.row, m.found))
	if err != nil || len(evs) == 0 {
		return err
	}
	m.row, m.found = next, true
	m.events = append(m.events, evs...)
	return nil
}

func keyring(t *testing.T) *sealbox.Keyring {
	t.Helper()
	k, err := sealbox.NewKeyring(1, map[int16][]byte{1: bytes.Repeat([]byte{5}, sealbox.KeySize)})
	if err != nil {
		t.Fatal(err)
	}
	return k
}

func TestSettingsDefaultsAndUpdate(t *testing.T) {
	store := &memSettings{}
	s := NewSettingsService(store, keyring(t))
	got, _ := s.Settings(context.Background())
	if got.Enabled || got.Model != "gpt-image-2" || got.Prices["gpt-image-2"].OutputImage != 30 || got.Key != nil {
		t.Errorf("defaults = %+v", got)
	}
	budget := int64(20_000_000)
	in := SettingsInput{Enabled: true, Model: "gpt-image-2", Quality: "low", Prices: map[string]Prices{"gpt-image-2": {OutputImage: 25}}, BudgetMicroUSD: &budget}
	got, err := s.Update(context.Background(), in, uuid.New())
	if err != nil || !got.Enabled || got.Quality != "low" || *got.BudgetMicroUSD != budget {
		t.Fatalf("update = %+v, %v", got, err)
	}
	if store.events[0].Event != EventSettingsChanged {
		t.Errorf("event = %s", store.events[0].Event)
	}
	for name, bad := range map[string]SettingsInput{
		"quality": {Model: "gpt-image-2", Quality: "ultra"},
		"model":   {Model: "GPT Image", Quality: "low"},
		"budget":  {Model: "gpt-image-2", Quality: "low", BudgetMicroUSD: new(int64(-1))},
		"a price": {Model: "gpt-image-2", Quality: "low", Prices: map[string]Prices{"gpt-image-2": {InputText: -1}}},
	} {
		if _, err := s.Update(context.Background(), bad, uuid.New()); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestKeyIsSealedShownByItsEndAndNeverInEvents(t *testing.T) {
	store := &memSettings{}
	s := NewSettingsService(store, keyring(t))
	key := "sk-proj-abcdefghijklmnop4f2a"
	got, err := s.SetKey(context.Background(), key, uuid.New())
	if err != nil || got.Key == nil || got.Key.Last4 != "4f2a" {
		t.Fatalf("set = %+v, %v", got, err)
	}
	if bytes.Contains(store.row.SealedKey, []byte("abcdefghijklmnop")) {
		t.Error("the key is stored in plain")
	}
	opened, err := s.Key(context.Background())
	if err != nil || opened != key {
		t.Errorf("key = %q, %v", opened, err)
	}
	for _, ev := range store.events {
		if strings.Contains(string(ev.Before)+string(ev.After), "abcdefghijklmnop") {
			t.Errorf("%s holds the key", ev.Event)
		}
	}
	if !strings.Contains(string(store.events[0].After), "…4f2a") {
		t.Errorf("set event = %s", store.events[0].After)
	}
	if _, err := s.SetKey(context.Background(), "short", uuid.New()); !errors.Is(err, ErrInvalid) {
		t.Errorf("a short key = %v", err)
	}
	if _, err := s.RemoveKey(context.Background(), uuid.New()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Key(context.Background()); !errors.Is(err, ErrNoKey) {
		t.Errorf("after removal = %v", err)
	}
	if _, err := s.RemoveKey(context.Background(), uuid.New()); !errors.Is(err, ErrNoKey) {
		t.Errorf("removing none = %v", err)
	}
	// Without API_SECRETS_KEY no key is saved.
	if _, err := NewSettingsService(&memSettings{}, nil).SetKey(context.Background(), key, uuid.New()); !errors.Is(err, ErrNoSecretsKey) {
		t.Errorf("no secrets key = %v", err)
	}
}
