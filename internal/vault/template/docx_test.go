package template

import (
	"bytes"
	"context"
	"errors"
	"io"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/vault/docx/docxtest"
)

// memStore is an in-memory files.Store.
type memStore struct {
	mu    sync.Mutex
	files map[string][]byte
}

func (s *memStore) Put(_ context.Context, key string, body io.Reader, _ int64, _ string) error {
	b, _ := io.ReadAll(body)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.files[key] = b
	return nil
}

func (s *memStore) Get(_ context.Context, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.files[key]
	if !ok {
		return nil, files.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(b)), nil
}

func (s *memStore) Delete(_ context.Context, key string) error { return nil }
func (s *memStore) String() string                             { return "mem" }

// A DOCX is a draft of its own kind: its placeholders joined and checked
// against the app's and the asked fields, kept in the store by its hash; its
// asked fields change without uploading it again; it is published only when
// it prints the number and the hash, and never changes after.
func TestUploadDocx(t *testing.T) {
	repo := &memRepo{rows: map[uuid.UUID]Template{}}
	store := &memStore{files: map[string][]byte{}}
	svc := NewService(repo, WithFiles(store))
	ctx := context.Background()
	actor := uuid.New()
	tpl, err := svc.Create(ctx, Details{Type: "employment.contract", Name: "Darbo sutartis", Language: "lt"}, actor)
	if err != nil {
		t.Fatal(err)
	}
	salary := []Asked{{Key: "salary", Label: "Alga", Kind: AskMoney, Required: true}}
	noHash := docxtest.Build([]string{"Darbo sutartis Nr. {{document.number}}", "{{employee.name}}, alga {{input.salary}}"}, "")

	for name, c := range map[string]struct {
		data  []byte
		asked []Asked
		want  error
		in    string
	}{
		"a PDF":            {[]byte("%PDF-1.7"), salary, ErrFileType, ""},
		"an unknown field": {docxtest.Build([]string{"{{employee.salary}}"}, ""), salary, ErrInvalid, "{{employee.salary}}"},
		"an unasked input": {noHash, nil, ErrInvalid, "{{input.salary}}"},
		"an unclosed {{":   {docxtest.Build([]string{"{{employee.name"}, ""), nil, ErrInvalid, "same paragraph"},
	} {
		_, err := svc.UploadDocx(ctx, tpl.ID, "s.docx", c.data, c.asked, actor)
		if !errors.Is(err, c.want) || !strings.Contains(err.Error(), c.in) {
			t.Errorf("%s: %v", name, err)
		}
	}

	got, err := svc.UploadDocx(ctx, tpl.ID, "C:\\docs\\Sutartis (galutinė).docx", noHash, salary, actor)
	if err != nil {
		t.Fatal(err)
	}
	draft, _ := got.Draft()
	if draft.Kind != KindDocx || draft.Docx == nil || draft.Docx.Name != "Sutartis galutinė.docx" || !draft.Body.IsDocx() ||
		!slices.Equal(draft.Body.DocxFields, []string{"document.number", "employee.name", "input.salary"}) {
		t.Fatalf("draft = %+v", draft)
	}
	if b, err := svc.DocxBytes(ctx, draft); err != nil || !bytes.Equal(b, noHash) {
		t.Errorf("stored = %v", err)
	}
	// Without {{document.hash}} it is not published.
	if _, err := svc.Publish(ctx, tpl.ID, actor); !errors.Is(err, ErrInvalid) || !strings.Contains(err.Error(), "document.hash") {
		t.Errorf("publish without the hash: %v", err)
	}
	withHash := docxtest.Build([]string{"Darbo sutartis Nr. {{document.number}}", "{{employee.name}}, alga {{input.salary}}"}, "SHA-256 {{document.hash}}")
	if got, err = svc.UploadDocx(ctx, tpl.ID, "s.docx", withHash, salary, actor); err != nil {
		t.Fatal(err)
	}
	draft, _ = got.Draft()
	// The asked fields change with the same DOCX; a body it does not hold is refused.
	salary[0].Label = "Mėnesio alga"
	if got, err = svc.SaveDraft(ctx, tpl.ID, draft.Body, salary, actor); err != nil {
		t.Fatal(err)
	}
	if d, _ := got.Draft(); d.Kind != KindDocx || d.Docx == nil || d.Asked[0].Label != "Mėnesio alga" {
		t.Errorf("asked changed = %+v", d)
	}
	other := draft.Body
	other.DocxSHA256 = strings.Repeat("0", 64)
	if _, err := svc.SaveDraft(ctx, tpl.ID, other, salary, actor); !errors.Is(err, ErrInvalid) {
		t.Errorf("a DOCX the draft does not hold: %v", err)
	}
	if _, err := svc.SaveDraft(ctx, tpl.ID, draft.Body, nil, actor); !errors.Is(err, ErrInvalid) {
		t.Errorf("an asked field the DOCX uses, dropped: %v", err)
	}
	pub, err := svc.Publish(ctx, tpl.ID, actor)
	if err != nil {
		t.Fatal(err)
	}
	v, ok := pub.Published()
	if !ok || v.Kind != KindDocx || v.Docx == nil {
		t.Errorf("published = %+v", v)
	}
	// Without a store, nothing is uploaded.
	if _, err := NewService(repo).UploadDocx(ctx, tpl.ID, "s.docx", withHash, salary, actor); !errors.Is(err, ErrNoStorage) {
		t.Errorf("without a store: %v", err)
	}
}
