package document

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // the JPEG decoder, for image.DecodeConfig

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/sealbox"
)

// Sealer is the master keyring over the people's data keys
// (API_PERSONNEL_KEY, a sealbox.Keyring): it seals and opens data keys only.
type Sealer interface {
	Seal(plain, context []byte) (sealed []byte, keyID int16, err error)
	Open(sealed []byte, keyID int16, context []byte) ([]byte, error)
}

// Keys are what Personnel files seals and looks up with.
type Keys struct {
	// Master seals each person's data key.
	Master Sealer
	// Index is the blind indexes' HMAC key (API_PERSONNEL_INDEX_KEY), 32 bytes.
	Index []byte
}

// configured reports whether both keys are there (the index key 32 bytes).
func (k Keys) configured() bool { return k.Master != nil && len(k.Index) == sealbox.KeySize }

// Configured reports whether Personnel files has its keys, for the contexts
// that seal with the master too (kept scans, internal/personnel/scan).
func (k Keys) Configured() bool { return k.configured() }

// The contexts each sealed value is bound to, so none opens in another row.
func subjectKeyContext(employee uuid.UUID) []byte {
	return []byte("ppe.personnel.subject_key.v1|" + employee.String())
}
func documentContext(document uuid.UUID) []byte {
	return []byte("ppe.personnel.document.v1|" + document.String())
}
func copyContext(copyID uuid.UUID) []byte { return []byte("ppe.personnel.copy.v1|" + copyID.String()) }

// numberIndex is the blind index of a document number: HMAC-SHA256 under the
// index key, the number's purpose and issuing state in the message so an
// index never matches across them.
func (k Keys) numberIndex(issuingState, number string) []byte {
	return k.hmac("number|" + issuingState + "|" + number)
}

// personalIndex is the blind index of a personal code.
func (k Keys) personalIndex(code string) []byte { return k.hmac("personal_code|" + code) }

// hmac is HMAC-SHA256 of msg under the index key.
func (k Keys) hmac(msg string) []byte {
	m := hmac.New(sha256.New, k.Index)
	m.Write([]byte(msg))
	return m.Sum(nil)
}

// newDataKey is a fresh data key for employee, and it sealed by the master.
func (k Keys) newDataKey(employee uuid.UUID) (*sealbox.Box, []byte, int16, error) {
	return k.NewDataKey(subjectKeyContext(employee))
}

// openDataKey opens employee's sealed data key.
func (k Keys) openDataKey(employee uuid.UUID, sealed []byte, keyID int16) (*sealbox.Box, error) {
	return k.OpenDataKey(sealed, keyID, subjectKeyContext(employee))
}

// NewDataKey is a fresh data key and it sealed by the master, bound to
// context (what the key is for: a person, a kept scan), so it opens nowhere else.
func (k Keys) NewDataKey(context []byte) (*sealbox.Box, []byte, int16, error) {
	raw := make([]byte, sealbox.KeySize)
	if _, err := rand.Read(raw); err != nil {
		return nil, nil, 0, err
	}
	sealed, keyID, err := k.Master.Seal(raw, context)
	if err != nil {
		return nil, nil, 0, err
	}
	box, err := sealbox.New(raw)
	return box, sealed, keyID, err
}

// OpenDataKey opens a data key NewDataKey sealed under context;
// ErrUnopenable when it does not open (another key, another context, a changed byte).
func (k Keys) OpenDataKey(sealed []byte, keyID int16, context []byte) (*sealbox.Box, error) {
	raw, err := k.Master.Open(sealed, keyID, context)
	if err != nil {
		if errors.Is(err, sealbox.ErrOpen) {
			return nil, ErrUnopenable
		}
		return nil, err
	}
	return sealbox.New(raw)
}

// CheckJPEG is checkJPEG, for the images other parts of Personnel files keep
// under the same rules (a kept scan's pages): ErrCopyNotJPEG when it is not one.
func CheckJPEG(b []byte) error { return checkJPEG(b) }

// checkJPEG: a Document Copy is a JPEG, read from its own bytes, at most
// maxCopySide on its longer side (the phone re-encodes it so, without metadata).
func checkJPEG(b []byte) error {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil || format != "jpeg" {
		return ErrCopyNotJPEG
	}
	if cfg.Width < 1 || cfg.Height < 1 || cfg.Width > maxCopySide || cfg.Height > maxCopySide {
		return ErrCopyNotJPEG
	}
	return nil
}

// sha256Of is b's SHA-256, as a copy's row keeps it.
func sha256Of(b []byte) []byte {
	s := sha256.Sum256(b)
	return s[:]
}

// objectKey is where a copy's sealed object is kept in the files store.
func objectKey(employee, document uuid.UUID, side Side, copyID uuid.UUID) string {
	return fmt.Sprintf("personnel/%s/%s/%s-%s", employee, document, side, copyID)
}
