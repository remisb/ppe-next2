package session

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// A refresh token is "<session id>.<generation>.<mac>", the mac an
// HMAC-SHA256 under the service's key of the id, the session's random seed and
// the generation. Nothing secret is stored: the server recomputes the mac to
// check a token, and can send the current token again (Refresh), while the
// table alone, without the key, cannot make one.

func (s *Service) mac(id uuid.UUID, seed []byte, generation int) []byte {
	h := hmac.New(sha256.New, s.key)
	h.Write(id[:])
	h.Write(seed)
	_ = binary.Write(h, binary.BigEndian, uint64(generation))
	return h.Sum(nil)
}

func (s *Service) token(cur Session) string {
	return cur.ID.String() + "." + strconv.Itoa(cur.Generation) + "." +
		base64.RawURLEncoding.EncodeToString(s.mac(cur.ID, cur.Seed, cur.Generation))
}

// parseToken splits a token; it does not check the mac.
func parseToken(raw string) (id uuid.UUID, generation int, mac []byte, err error) {
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return uuid.Nil, 0, nil, ErrInvalidToken
	}
	if id, err = uuid.Parse(parts[0]); err != nil {
		return uuid.Nil, 0, nil, ErrInvalidToken
	}
	if generation, err = strconv.Atoi(parts[1]); err != nil || generation < 1 {
		return uuid.Nil, 0, nil, ErrInvalidToken
	}
	if mac, err = base64.RawURLEncoding.DecodeString(parts[2]); err != nil || len(mac) != sha256.Size {
		return uuid.Nil, 0, nil, ErrInvalidToken
	}
	return id, generation, mac, nil
}

// matches reports whether mac is cur's for generation, in constant time.
func (s *Service) matches(cur Session, generation int, mac []byte) bool {
	return hmac.Equal(mac, s.mac(cur.ID, cur.Seed, generation))
}
