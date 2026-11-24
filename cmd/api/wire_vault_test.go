package main

import (
	"testing"

	"github.com/remisb/ppe-next2/internal/domain/asset"
	"github.com/remisb/ppe-next2/internal/domain/role"
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
