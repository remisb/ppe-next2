package document

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"slices"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/outbox"
	"github.com/remisb/ppe-next2/internal/vault/extract"
)

// KindReadText is the worker's job that reads a version's file for search
// (docs/specs/vault-service.md, "Reading text"), keyed by the version's id.
// Every stored version without known text gets one in its own transaction.
const KindReadText = "vault.extract_text"

// ReadTextJob is the job's payload: ids only.
type ReadTextJob struct {
	Version uuid.UUID `json:"version"`
}

// Text states (vault.version_text.state).
const (
	TextPending = "pending"
	TextReading = "reading"
	TextRead    = "read"
	TextNone    = "none"
	TextFailed  = "failed"
	TextSkipped = "skipped"
)

// TextReader reads a file's words: extract.Reader, in the worker.
type TextReader interface {
	Read(ctx context.Context, contentType string, data []byte) (extract.Result, error)
}

// TextUpdate is what reading made of a version.
type TextUpdate struct {
	State    string
	Method   string
	Language string
	Pages    int
	// Content is the text; a sealed document's is kept only as search words
	// none of which holds a digit, and never as text.
	Content string
	Sealed  bool
	// Error is a short code ("damaged", "timeout", "unreadable") for a failed one.
	Error string
	At    time.Time
}

// WithTextReader lets the service read files (the worker's).
func WithTextReader(r TextReader) Option { return func(s *Service) { s.text = r } }

// readTextFor is the job that reads version's text, for insertVersion and Read Again.
func readTextFor(version uuid.UUID) (kind, key string, payload ReadTextJob) {
	return KindReadText, version.String(), ReadTextJob{Version: version}
}

// ReadText is the job: it reads version's file and keeps its words, then
// rebuilds the document's search. A version gone (shredded, or its document
// removed) is nothing to do. last says this is the job's last attempt: a
// failure is then recorded as the version's state. A file that does not
// match its hash fails at once.
func (s *Service) ReadText(ctx context.Context, version uuid.UUID, last bool) error {
	if s.text == nil {
		return errors.New("vault: no text reader")
	}
	if s.store == nil {
		return ErrNoStorage
	}
	docID, err := s.repo.VersionDocument(ctx, version)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	d, err := s.repo.Get(ctx, docID)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	i := slices.IndexFunc(d.Versions, func(v Version) bool { return v.ID == version })
	if i < 0 {
		return nil
	}
	f := d.Versions[i].File
	fail := func(code string, cause error, permanent bool) error {
		if permanent || last {
			if err := s.repo.SetText(ctx, version, TextUpdate{State: TextFailed, Error: code, Sealed: d.Sealed, At: s.now()}); err != nil {
				return err
			}
		}
		if permanent {
			return outbox.Permanent(cause)
		}
		return cause
	}
	if err := s.repo.SetText(ctx, version, TextUpdate{State: TextReading, Sealed: d.Sealed, At: s.now()}); err != nil {
		return err
	}
	data, err := s.fileBytes(ctx, d, f)
	if errors.Is(err, ErrDamaged) {
		return fail("damaged", err, true)
	}
	if err != nil {
		return fail("unreadable", err, false)
	}
	res, err := s.text.Read(ctx, f.ContentType, data)
	switch {
	case errors.Is(err, extract.ErrUnsupported):
		return s.repo.SetText(ctx, version, TextUpdate{State: TextSkipped, Sealed: d.Sealed, At: s.now()})
	case errors.Is(err, extract.ErrNoText):
		return s.repo.SetText(ctx, version, TextUpdate{State: TextNone, Sealed: d.Sealed, At: s.now()})
	case errors.Is(err, context.DeadlineExceeded):
		return fail("timeout", err, false)
	case errors.Is(err, extract.ErrMissingTool):
		return fail("tool_missing", err, false)
	case err != nil:
		return fail("unreadable", err, false)
	}
	return s.repo.SetText(ctx, version, TextUpdate{
		State: TextRead, Method: res.Method, Language: res.Language, Pages: res.Pages,
		Content: res.Text, Sealed: d.Sealed, At: s.now(),
	})
}

// fileBytes are f's bytes as stored, opened with the document's key when
// sealed, checked against the hash taken when it was stored.
func (s *Service) fileBytes(ctx context.Context, d Document, f File) ([]byte, error) {
	r, err := s.store.Get(ctx, f.ObjectKey)
	if err != nil {
		return nil, fmt.Errorf("vault: file %s: %w", f.ID, err)
	}
	defer r.Close()
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("vault: reading file %s: %w", f.ID, err)
	}
	if f.Sealed {
		box, err := s.openKey(d)
		if err != nil {
			return nil, err
		}
		if data, err = box.Open(data, fileContext(f.ID)); err != nil {
			return nil, fmt.Errorf("%w: file %s does not open", ErrDamaged, f.ID)
		}
	}
	if sum := sha256.Sum256(data); hex.EncodeToString(sum[:]) != f.SHA256 {
		return nil, fmt.Errorf("%w: file %s", ErrDamaged, f.ID)
	}
	return data, nil
}

// ReadAgain asks the worker to read version n's file again (after a failure,
// or a better reader), for a reader who may change the document. A
// generated version's text is its own: there is nothing to read.
func (s *Service) ReadAgain(ctx context.Context, reader Reader, id uuid.UUID, n int) (Document, error) {
	d, _, err := s.manageable(ctx, reader, id)
	if err != nil {
		return Document{}, err
	}
	i := slices.IndexFunc(d.Versions, func(v Version) bool { return v.Number == n })
	if i < 0 {
		return Document{}, ErrNotFound
	}
	v := d.Versions[i]
	if v.Origin == VersionGenerated {
		return Document{}, fieldError("version", "was generated: its text is known")
	}
	if v.TextState == TextPending || v.TextState == TextReading {
		return s.Get(ctx, reader, id)
	}
	if err := s.repo.ReadAgain(ctx, v.ID, s.now()); err != nil {
		return Document{}, err
	}
	return s.Get(ctx, reader, id)
}

// QueueUnread gives every version still waiting for its text, or whose
// reading failed when failed, a job (`api -vault-reindex`): the ones stored
// before the worker existed, or after a fix.
func (s *Service) QueueUnread(ctx context.Context, failed bool) (int64, error) {
	return s.repo.QueueUnread(ctx, failed, s.now())
}
