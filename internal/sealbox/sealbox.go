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
