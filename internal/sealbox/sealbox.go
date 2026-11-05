// Package sealbox seals small secrets kept in the database, such as a SIM
// card's PIN and PUK (ADR 0005), with AES-256-GCM under a key the database
// never holds, so a dump or a backup carries only ciphertext. Each sealed
// value is bound to a context (the row it belongs to), so a sealed value
// copied to another row does not open there.
package sealbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// KeySize is the key's length in bytes: AES-256.
const KeySize = 32

// version is a sealed value's first byte: its format, which names the
// cipher and the nonce size, so a later format can sit beside this one.
const version byte = 1

// ErrOpen is a sealed value that does not open: another key, another
// context, a changed byte or an unknown format.
var ErrOpen = errors.New("sealbox: the sealed value does not open")

// Box seals and opens values with one key.
type Box struct {
	aead cipher.AEAD
}

// New is a Box for key, which must be KeySize bytes.
func New(key []byte) (*Box, error) {
	if len(key) != KeySize {
		return nil, fmt.Errorf("sealbox: the key must be %d bytes, not %d", KeySize, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// ParseKey reads a key written as 64 hex characters, as `openssl rand -hex 32` prints it.
func ParseKey(s string) ([]byte, error) {
	key, err := hex.DecodeString(s)
	if err != nil || len(key) != KeySize {
		return nil, fmt.Errorf("must be %d hex characters (openssl rand -hex %d)", 2*KeySize, KeySize)
	}
	return key, nil
}

// Seal is plain sealed for context: the version byte, a random nonce, then
// the ciphertext with its tag.
func (b *Box) Seal(plain, context []byte) ([]byte, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	out := make([]byte, 0, 1+len(nonce)+len(plain)+b.aead.Overhead())
	out = append(out, version)
	out = append(out, nonce...)
	return b.aead.Seal(out, nonce, plain, context), nil
}

// Open is the value Seal sealed for the same context, or ErrOpen.
func (b *Box) Open(sealed, context []byte) ([]byte, error) {
	n := b.aead.NonceSize()
	if len(sealed) < 1+n+b.aead.Overhead() || sealed[0] != version {
		return nil, ErrOpen
	}
	plain, err := b.aead.Open(nil, sealed[1:1+n], sealed[1+n:], context)
	if err != nil {
		return nil, ErrOpen
	}
	return plain, nil
}

// Keyring seals with its current key and opens with any of its keys, each
// named by an id stored beside what it sealed (ADR 0005: a key can be
// changed). The previous keys only open: a key change seals everything again
// under the current one, then the previous key can go once no row and no
// kept backup needs it (docs/backups.md).
type Keyring struct {
	current int16
	boxes   map[int16]*Box
}

// NewKeyring is a Keyring sealing with keys[current]; ids are from 1.
func NewKeyring(current int16, keys map[int16][]byte) (*Keyring, error) {
	if _, ok := keys[current]; !ok {
		return nil, fmt.Errorf("sealbox: no key %d to seal with", current)
	}
	k := &Keyring{current: current, boxes: make(map[int16]*Box, len(keys))}
	for id, key := range keys {
		if id < 1 {
			return nil, fmt.Errorf("sealbox: key id %d is not from 1", id)
		}
		box, err := New(key)
		if err != nil {
			return nil, fmt.Errorf("sealbox: key %d: %w", id, err)
		}
		k.boxes[id] = box
	}
	return k, nil
}

// Current is the id of the key Seal uses.
func (k *Keyring) Current() int16 { return k.current }

// Seal is plain sealed for context under the current key, and that key's id.
func (k *Keyring) Seal(plain, context []byte) ([]byte, int16, error) {
	sealed, err := k.boxes[k.current].Seal(plain, context)
	return sealed, k.current, err
}

// Open is the value sealed for context under key keyID, or ErrOpen (a key
// this keyring does not have is ErrOpen too, naming no value).
func (k *Keyring) Open(sealed []byte, keyID int16, context []byte) ([]byte, error) {
	box, ok := k.boxes[keyID]
	if !ok {
		return nil, fmt.Errorf("%w: no key %d", ErrOpen, keyID)
	}
	return box.Open(sealed, context)
}

// ParseKeys reads keys written as "id:hex" pairs separated by commas, each
// key as ParseKey reads it, as API_SIM_CODES_PREVIOUS_KEYS holds them. An
// empty string is no keys.
func ParseKeys(s string) (map[int16][]byte, error) {
	keys := map[int16][]byte{}
	for part := range strings.SplitSeq(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		idText, hexKey, ok := strings.Cut(part, ":")
		id, err := strconv.ParseInt(strings.TrimSpace(idText), 10, 16)
		if !ok || err != nil || id < 1 {
			return nil, errors.New(`must be "id:key" pairs separated by commas, each id a number from 1`)
		}
		key, err := ParseKey(strings.TrimSpace(hexKey))
		if err != nil {
			return nil, fmt.Errorf("key %d %w", id, err)
		}
		if _, dup := keys[int16(id)]; dup {
			return nil, fmt.Errorf("key %d is given twice", id)
		}
		keys[int16(id)] = key
	}
	return keys, nil
}
