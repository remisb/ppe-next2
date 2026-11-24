package vault

import (
	"os/exec"
	"strings"
	"testing"
)

// TestVaultImportsNoContext pins ADR 0008 decision 1: nothing under
// internal/vault imports a domain or Personnel files. What the vault needs
// from them comes through ports it declares, adapted in cmd/api/wire_vault.go.
func TestVaultImportsNoContext(t *testing.T) {
	out, err := exec.Command("go", "list", "-deps", "-f", "{{.ImportPath}}", "./...").Output()
	if err != nil {
		t.Fatalf("go list: %v", err)
	}
	for _, dep := range strings.Fields(string(out)) {
		for _, banned := range []string{"/internal/domain/", "/internal/personnel/"} {
			if strings.Contains(dep, banned) {
				t.Errorf("internal/vault depends on %s", dep)
			}
		}
	}
}
