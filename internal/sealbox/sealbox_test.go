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

func TestKeyring(t *testing.T) {
	oldKey, newKey := bytes.Repeat([]byte{1}, KeySize), bytes.Repeat([]byte{2}, KeySize)
	before, err := NewKeyring(1, map[int16][]byte{1: oldKey})
	if err != nil {
		t.Fatal(err)
	}
	sealedBefore, id, err := before.Seal([]byte("0306 93691381"), []byte("card"))
	if err != nil || id != 1 || before.Current() != 1 {
		t.Fatalf("seal = key %d, %v", id, err)
	}
	// After a key change: the new key seals, the old one still opens what it sealed.
	after, err := NewKeyring(2, map[int16][]byte{1: oldKey, 2: newKey})
	if err != nil {
		t.Fatal(err)
	}
	if plain, err := after.Open(sealedBefore, 1, []byte("card")); err != nil || string(plain) != "0306 93691381" {
		t.Errorf("open under the previous key = %q, %v", plain, err)
	}
	sealedAfter, id, err := after.Seal([]byte("0306 93691381"), []byte("card"))
	if err != nil || id != 2 {
		t.Fatalf("seal after the change = key %d, %v", id, err)
	}
	// A key named wrongly, or one the keyring does not have, does not open.
	for name, try := range map[string]func() ([]byte, error){
		"the wrong key's id": func() ([]byte, error) { return after.Open(sealedAfter, 1, []byte("card")) },
		"a key not given":    func() ([]byte, error) { return before.Open(sealedAfter, 2, []byte("card")) },
	} {
		if _, err := try(); !errors.Is(err, ErrOpen) {
			t.Errorf("%s: %v, want ErrOpen", name, err)
		}
	}
	for name, keys := range map[string]map[int16][]byte{
		"no current key": {1: oldKey},
		"an id below 1":  {2: newKey, 0: oldKey},
		"a short key":    {2: newKey, 1: oldKey[:16]},
	} {
		if _, err := NewKeyring(2, keys); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestParseKeys(t *testing.T) {
	a, b := strings.Repeat("ab", 32), strings.Repeat("cd", 32)
	keys, err := ParseKeys(" 1:" + a + " , 7:" + b + ",")
	if err != nil || len(keys) != 2 || keys[1][0] != 0xab || keys[7][0] != 0xcd {
		t.Fatalf("keys = %v, %v", keys, err)
	}
	if keys, err := ParseKeys(""); err != nil || len(keys) != 0 {
		t.Errorf("none = %v, %v", keys, err)
	}
	for _, bad := range []string{a, "x:" + a, "0:" + a, "1:" + a[:10], "1:" + a + ",1:" + b, "40000:" + a} {
		if _, err := ParseKeys(bad); err == nil {
			t.Errorf("%.20q…: expected an error", bad)
		} else if strings.Contains(err.Error(), a) || strings.Contains(err.Error(), b) {
			t.Errorf("the error quotes a key: %v", err)
		}
	}
}
