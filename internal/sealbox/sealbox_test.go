package sealbox

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func box(t *testing.T, fill byte) *Box {
	t.Helper()
	b, err := New(bytes.Repeat([]byte{fill}, KeySize))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestSealOpens(t *testing.T) {
	b := box(t, 1)
	sealed, err := b.Seal([]byte("0306 93691381"), []byte("row-1"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(sealed, []byte("0306")) || bytes.Contains(sealed, []byte("93691381")) {
		t.Fatalf("sealed value holds the plain text: %x", sealed)
	}
	got, err := b.Open(sealed, []byte("row-1"))
	if err != nil || string(got) != "0306 93691381" {
		t.Fatalf("Open = %q, %v", got, err)
	}
}

func TestOpenRefuses(t *testing.T) {
	b := box(t, 1)
	sealed, err := b.Seal([]byte("secret"), []byte("row-1"))
	if err != nil {
		t.Fatal(err)
	}
	changed := bytes.Clone(sealed)
	changed[len(changed)-1] ^= 1
	future := bytes.Clone(sealed)
	future[0] = 2
	for name, c := range map[string]struct {
		box     *Box
		sealed  []byte
		context string
	}{
		"another context": {b, sealed, "row-2"},
		"another key":     {box(t, 2), sealed, "row-1"},
		"a changed byte":  {b, changed, "row-1"},
		"another version": {b, future, "row-1"},
		"too short":       {b, sealed[:10], "row-1"},
		"empty":           {b, nil, "row-1"},
	} {
		if _, err := c.box.Open(c.sealed, []byte(c.context)); !errors.Is(err, ErrOpen) {
			t.Errorf("%s: Open = %v, want ErrOpen", name, err)
		}
	}
}

func TestSealUsesAFreshNonce(t *testing.T) {
	b := box(t, 1)
	x, _ := b.Seal([]byte("same"), []byte("row"))
	y, _ := b.Seal([]byte("same"), []byte("row"))
	if bytes.Equal(x, y) {
		t.Fatal("two seals of the same value are equal")
	}
}

func TestKeys(t *testing.T) {
	if _, err := New(make([]byte, 16)); err == nil {
		t.Error("New took a 16-byte key")
	}
	if k, err := ParseKey(strings.Repeat("ab", KeySize)); err != nil || len(k) != KeySize {
		t.Errorf("ParseKey = %x, %v", k, err)
	}
	for _, s := range []string{"", strings.Repeat("ab", 16), strings.Repeat("zz", KeySize)} {
		if _, err := ParseKey(s); err == nil {
			t.Errorf("ParseKey(%q) took it", s)
		}
	}
}
