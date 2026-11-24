package main

import (
	"strings"
	"testing"

	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/employee"
	"github.com/remisb/ppe-next2/internal/domain/role"
	"github.com/remisb/ppe-next2/internal/sealbox"
	"github.com/remisb/ppe-next2/internal/vault"
)

// TestVaultPermissionsAreTheCatalogues keeps the permission keys the vault's
// types name (it may not import role) in the catalogue.
func TestVaultPermissionsAreTheCatalogues(t *testing.T) {
	if vault.PermRead != string(role.VaultRead) || vault.PermManage != string(role.VaultManage) {
		t.Fatalf("vault's %s/%s, role's %s/%s", vault.PermRead, vault.PermManage, role.VaultRead, role.VaultManage)
	}
	for _, p := range vault.Permissions() {
		if !role.IsKnown(p) {
			t.Errorf("a type names %q, which is no permission", p)
		}
	}
}

func TestAssetLabelAndSight(t *testing.T) {
	name, phone := "Laptop", "+37060000000"
	if got := assetLabel(asset.Asset{InventoryNo: "EQ-0001", Name: &name}); got != "EQ-0001 Laptop" {
		t.Errorf("equipment = %q", got)
	}
	if got := assetLabel(asset.Asset{InventoryNo: "SIM-0002", PhoneNo: &phone}); got != "SIM-0002 +37060000000" {
		t.Errorf("SIM = %q", got)
	}
	if got := assetLabel(asset.Asset{InventoryNo: "EQ-0003"}); got != "EQ-0003" {
		t.Errorf("no name = %q", got)
	}
	if assetSight(asset.KindSIM) != role.SIMCardsRead || assetSight(asset.KindEquipment) != role.EquipmentRead {
		t.Error("asset sight")
	}
}

const testVaultKey = "a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4a4"

// testVaultKeys is the Document Vault's keyring in tests.
func testVaultKeys(t *testing.T) *sealbox.Keyring {
	t.Helper()
	keys, err := vaultKeyring(config{VaultKey: testVaultKey, VaultKeyID: 1})
	if err != nil {
		t.Fatal(err)
	}
	return keys
}

func TestVaultKeyErrors(t *testing.T) {
	ok := config{JWTSecret: strings.Repeat("s", 32), SIMCodesKey: strings.Repeat("ab", 32), VaultKeyID: 1}
	if errs := ok.vaultKeyErrors(); len(errs) != 0 {
		t.Fatalf("no key: %v", errs)
	}
	for name, c := range map[string]config{
		"short":         {VaultKey: "abcd", VaultKeyID: 1},
		"the SIM key":   {SIMCodesKey: testVaultKey, VaultKey: testVaultKey, VaultKeyID: 1},
		"id 0":          {VaultKey: testVaultKey, VaultKeyID: 0},
		"previous same": {VaultKey: testVaultKey, VaultKeyID: 1, VaultPreviousKeys: "2:" + testVaultKey},
		"previous id":   {VaultKey: testVaultKey, VaultKeyID: 1, VaultPreviousKeys: "1:" + strings.Repeat("cd", 32)},
	} {
		if errs := c.vaultKeyErrors(); len(errs) == 0 {
			t.Errorf("%s: no error", name)
		}
	}
	if keys, err := vaultKeyring(config{}); keys != nil || err != nil {
		t.Errorf("no key = %v, %v", keys, err)
	}
}

func TestEmploymentEnded(t *testing.T) {
	day := func(s string) *string { return &s }
	for _, c := range []struct {
		periods []employee.Employment
		ended   bool
		on      string
	}{
		{nil, false, ""},
		{[]employee.Employment{{EndedOn: day("2025-01-31")}, {EndedOn: nil}}, false, ""},
		{[]employee.Employment{{EndedOn: day("2025-01-31")}, {EndedOn: day("2026-06-30")}}, true, "2026-06-30"},
	} {
		if ended, on, _ := employmentEnded(c.periods); ended != c.ended || on != c.on {
			t.Errorf("%v: %v %q", c.periods, ended, on)
		}
	}
}
