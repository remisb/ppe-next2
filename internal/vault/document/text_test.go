package document

import (
	"context"
	"errors"
	"testing"

	"github.com/remisb/ppe-next2/internal/outbox"
	"github.com/remisb/ppe-next2/internal/vault"
	"github.com/remisb/ppe-next2/internal/vault/extract"
)

// stubText answers with res and err, recording the bytes it was given.
type stubText struct {
	res  extract.Result
	err  error
	got  []byte
	kind string
}

func (s *stubText) Read(_ context.Context, contentType string, data []byte) (extract.Result, error) {
	s.got, s.kind = data, contentType
	return s.res, s.err
}

func TestReadText(t *testing.T) {
	ctx := context.Background()
	f := newFixture()
	text := &stubText{res: extract.Result{Text: "Working at height", Method: extract.MethodPDFText, Language: "eng", Pages: 1}}
	f.svc.text = text
	d, err := f.svc.Upload(ctx, manager, "employee.certificate", certificate(LinkRef{vault.Employee, ana}), Upload{FileName: "c.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	v := d.Current()
	if err := f.svc.ReadText(ctx, v.ID, false); err != nil {
		t.Fatal(err)
	}
	if string(text.got) != string(pdf) || text.kind != "application/pdf" {
		t.Fatalf("read %q as %s", text.got, text.kind)
	}
	if n := len(f.repo.texts); n != 2 || f.repo.texts[0].State != TextReading || f.repo.texts[1].State != TextRead ||
		f.repo.texts[1].Content != "Working at height" || f.repo.texts[1].Sealed {
		t.Fatalf("texts = %+v", f.repo.texts)
	}

	// Nothing to read, a file of another kind: recorded, not retried.
	f.repo.texts = nil
	text.err = extract.ErrNoText
	if err := f.svc.ReadText(ctx, v.ID, false); err != nil || f.repo.texts[1].State != TextNone {
		t.Fatalf("no text: %v %+v", err, f.repo.texts)
	}
	f.repo.texts = nil
	text.err = extract.ErrUnsupported
	if err := f.svc.ReadText(ctx, v.ID, false); err != nil || f.repo.texts[1].State != TextSkipped {
		t.Fatalf("unsupported: %v %+v", err, f.repo.texts)
	}

	// A tool failing is retried; on the last attempt it is recorded as failed.
	f.repo.texts = nil
	text.err = errors.New("tesseract: exit status 1")
	if err := f.svc.ReadText(ctx, v.ID, false); err == nil || outbox.IsPermanent(err) || len(f.repo.texts) != 1 {
		t.Fatalf("first failure: %v %+v", err, f.repo.texts)
	}
	if err := f.svc.ReadText(ctx, v.ID, true); err == nil || f.repo.texts[2].State != TextFailed || f.repo.texts[2].Error != "unreadable" {
		t.Fatalf("last failure: %v %+v", err, f.repo.texts)
	}

	// A file that does not match its hash fails at once.
	f.repo.texts = nil
	f.store.files[v.File.ObjectKey] = []byte("%PDF-changed")
	if err := f.svc.ReadText(ctx, v.ID, false); !outbox.IsPermanent(err) || !errors.Is(err, ErrDamaged) || f.repo.texts[1].Error != "damaged" {
		t.Fatalf("damaged: %v %+v", err, f.repo.texts)
	}

	// A removed document, or a version that no longer exists, is nothing to do.
	if err := f.svc.Remove(ctx, manager, d.ID); err != nil {
		t.Fatal(err)
	}
	f.repo.texts = nil
	if err := f.svc.ReadText(ctx, v.ID, false); err != nil || len(f.repo.texts) != 0 {
		t.Fatalf("removed: %v %+v", err, f.repo.texts)
	}
}

func TestReadTextOpensSealedFiles(t *testing.T) {
	ctx := context.Background()
	f := newSealedFixture(t)
	text := &stubText{res: extract.Result{Text: "Darbo sutartis 2400", Method: extract.MethodOCR, Language: "lit+eng", Pages: 2}}
	f.svc.text = text
	d := contract(f, t)
	if err := f.svc.ReadText(ctx, d.Current().ID, false); err != nil {
		t.Fatal(err)
	}
	if string(text.got) != string(pdf) {
		t.Fatalf("the reader got the sealed bytes, not the file")
	}
	if last := f.repo.texts[len(f.repo.texts)-1]; !last.Sealed || last.State != TextRead {
		t.Fatalf("text = %+v", last)
	}
}

func TestReadAgain(t *testing.T) {
	ctx := context.Background()
	f := newFixture()
	d, err := f.svc.Upload(ctx, manager, "employee.certificate", certificate(LinkRef{vault.Employee, ana}), Upload{FileName: "c.pdf", Data: pdf})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ReadAgain(ctx, reader, d.ID, 1); !errors.Is(err, ErrForbidden) {
		t.Fatalf("a reader may not: %v", err)
	}
	if _, err := f.svc.ReadAgain(ctx, manager, d.ID, 9); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no version 9: %v", err)
	}
	got, err := f.svc.ReadAgain(ctx, manager, d.ID, 1)
	if err != nil || len(f.repo.queued) != 1 || f.repo.queued[0] != d.Current().ID || got.Current().TextState != TextPending {
		t.Fatalf("read again: %v %v %+v", err, f.repo.queued, got.Current())
	}
	// Already waiting: no second job.
	if _, err := f.svc.ReadAgain(ctx, manager, d.ID, 1); err != nil || len(f.repo.queued) != 1 {
		t.Fatalf("again while pending: %v %v", err, f.repo.queued)
	}
}
