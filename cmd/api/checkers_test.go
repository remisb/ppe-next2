package main

import (
	"context"
	"strings"
	"testing"

	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/settings"
)

// TestAssetMailerFillsInSettings: a SIM card's email takes the provider's
// e-mail from Settings, and the provider's default plan for a card without
// one, as Give SIM fills it in; a card's own plan wins.
func TestAssetMailerFillsInSettings(t *testing.T) {
	api := newTestAPI(t)
	ctx := context.Background()
	if _, err := api.svc.settings.UpdateSIMProviders(ctx, settings.SIMProvidersParams{
		Providers: []settings.SIMProvider{{Name: "Bitė", Email: "sim@bite.lt", DefaultPlan: "30 Eur"}},
	}, api.admin.ID); err != nil {
		t.Fatal(err)
	}
	mailer := assetMailer{templates: api.svc.templates, settings: api.svc.settings, users: api.svc.users}
	card := asset.EmailCard{SIMNumber: "00200", Provider: "bitė", Actor: api.admin.ID}

	m, err := mailer.SIMEmail(ctx, asset.EmailActivation, card)
	if err != nil {
		t.Fatal(err)
	}
	if m.To != "sim@bite.lt" || !strings.Contains(m.Body, "Plan: 30 Eur") || !strings.Contains(m.Body, "\nAdmin") {
		t.Fatalf("without a plan: %+v", m)
	}
	card.Plan = "Biz 10 GB"
	if m, _ := mailer.SIMEmail(ctx, asset.EmailActivation, card); !strings.Contains(m.Body, "Plan: Biz 10 GB") {
		t.Fatalf("with its own plan: %+v", m)
	}
	// A provider not listed has no e-mail or plan: both are left to fill in.
	card.Provider, card.Plan = "Tele2", ""
	if m, _ := mailer.SIMEmail(ctx, asset.EmailActivation, card); m.To != "[Provider E-mail]" || !strings.Contains(m.Body, "Plan: [Plan]") {
		t.Fatalf("an unlisted provider: %+v", m)
	}
}
