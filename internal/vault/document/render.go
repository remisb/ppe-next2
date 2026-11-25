package document

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/gob"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/remisb/ppe-next2/internal/audit"
	"github.com/remisb/ppe-next2/internal/files"
	"github.com/remisb/ppe-next2/internal/sealbox"
)

// Renders (phase 8; docs/specs/document-template-service.md, "DOCX
// templates"): a DOCX template's preview or document is filled by the API
// and converted to PDF by the worker (LibreOffice), which the API's image
// does not hold. The API keeps the filled DOCX as a render, sealed with a key
// of its own, and answers at once with its id; the app asks again until the
// worker has made the PDF. A document's render holds the document to make,
// sealed; it is made when its PDF is there and the app asks for it.

// KindRenderDocx is the worker's job that converts a render's DOCX to PDF.
const KindRenderDocx = "vault.render_docx"

// RenderJob is the job's payload: the render's id.
type RenderJob struct {
	Render uuid.UUID `json:"render"`
}

// Render purposes and states (vault.renders).
const (
	RenderPreview  = "preview"
	RenderDocument = "document"

	RenderPending  = "pending"
	RenderDone     = "done"
	RenderFailed   = "failed"
	RenderFinished = "finished"
)

// renderMaxAge is how long a render and its files are kept.
const renderMaxAge = time.Hour

// ErrRenderFailed: the worker could not convert the DOCX.
var ErrRenderFailed = errors.New("vault: the document could not be converted to PDF")

// Render is a DOCX on its way to a PDF.
type Render struct {
	ID         uuid.UUID
	Purpose    string
	State      string
	SealedKey  []byte
	KeyID      int16
	DataSealed []byte
	ValuesHash *string
	DocumentID *uuid.UUID
	Error      *string
	CreatedAt  time.Time
	CreatedBy  uuid.UUID
}

// Converter makes a PDF of a DOCX: docx.Converter, in the worker.
type Converter interface {
	Convert(ctx context.Context, data []byte) ([]byte, error)
}

// WithConverter lets the service convert renders (the worker's).
func WithConverter(c Converter) Option { return func(s *Service) { s.converter = c } }

func renderKeyContext(id uuid.UUID) []byte  { return []byte("ppe.vault.render_key.v1|" + id.String()) }
func renderFileContext(id uuid.UUID) []byte { return []byte("ppe.vault.render_file.v1|" + id.String()) }
func renderDataContext(id uuid.UUID) []byte { return []byte("ppe.vault.render_data.v1|" + id.String()) }

func renderDocx(id uuid.UUID) string { return "vault/renders/" + id.String() + ".docx" }
func renderPDF(id uuid.UUID) string  { return "vault/renders/" + id.String() + ".pdf" }

// pendingDocument is what a document's render makes once its PDF is there.
type pendingDocument struct {
	Document Document
	Links    []Link
	Event    audit.Event
}

// startRender keeps filled, a DOCX, as a new render of purpose for reader
// (its data, a document's, sealed with it), and queues its conversion.
func (s *Service) startRender(ctx context.Context, reader Reader, purpose string, filled []byte, valuesHash *string, pending *pendingDocument) (uuid.UUID, error) {
	if s.store == nil {
		return uuid.Nil, ErrNoStorage
	}
	if s.keys == nil {
		return uuid.Nil, ErrNotConfigured
	}
	id := s.newID()
	box, key, keyID, err := sealbox.NewDataKey(s.keys, renderKeyContext(id))
	if err != nil {
		return uuid.Nil, err
	}
	r := Render{ID: id, Purpose: purpose, State: RenderPending, SealedKey: key, KeyID: keyID, ValuesHash: valuesHash,
		CreatedAt: s.now(), CreatedBy: reader.ID}
	if pending != nil {
		var raw bytes.Buffer
		// gob, not JSON: it keeps the fields the API's answers leave out (a
		// sealed document's key, the objects' keys, the values).
		if err := gob.NewEncoder(&raw).Encode(pending); err != nil {
			return uuid.Nil, err
		}
		if r.DataSealed, err = box.Seal(raw.Bytes(), renderDataContext(id)); err != nil {
			return uuid.Nil, err
		}
	}
	sealed, err := box.Seal(filled, renderFileContext(id))
	if err != nil {
		return uuid.Nil, err
	}
	if err := s.store.Put(ctx, renderDocx(id), bytes.NewReader(sealed), int64(len(sealed)), files.DOCX); err != nil {
		return uuid.Nil, fmt.Errorf("vault: storing the render: %w", err)
	}
	return id, s.repo.CreateRender(ctx, r)
}

// renderBox opens a render's key.
func (s *Service) renderBox(r Render) (*sealbox.Box, error) {
	if s.keys == nil {
		return nil, ErrNotConfigured
	}
	return sealbox.OpenDataKey(s.keys, r.SealedKey, r.KeyID, renderKeyContext(r.ID))
}

// readSealed reads key from the store and opens it with box under context.
func (s *Service) readSealed(ctx context.Context, box *sealbox.Box, key string, context []byte) ([]byte, error) {
	rc, err := s.store.Get(ctx, key)
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	sealed, err := io.ReadAll(rc)
	if err != nil {
		return nil, err
	}
	data, err := box.Open(sealed, context)
	if err != nil {
		return nil, fmt.Errorf("%w: a render's file does not open", ErrDamaged)
	}
	return data, nil
}

// RenderDocx is the worker's job: render id's DOCX converted and kept as its
// PDF. A render no longer pending is done already; last says this is the
// job's last attempt, when a failure is recorded on the render.
func (s *Service) RenderDocx(ctx context.Context, id uuid.UUID, last bool) error {
	if s.converter == nil {
		return errors.New("vault: no DOCX converter")
	}
	r, err := s.repo.GetRender(ctx, id)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil || r.State != RenderPending {
		return err
	}
	fail := func(code string, cause error) error {
		if last || errors.Is(cause, ErrDamaged) {
			if err := s.repo.FinishRender(context.WithoutCancel(ctx), id, RenderFailed, &code, s.now()); err != nil {
				return err
			}
		}
		return cause
	}
	box, err := s.renderBox(r)
	if err != nil {
		return err
	}
	filled, err := s.readSealed(ctx, box, renderDocx(id), renderFileContext(id))
	if err != nil {
		return fail("damaged", err)
	}
	pdf, err := s.converter.Convert(ctx, filled)
	if err != nil {
		code := "conversion_failed"
		if errors.Is(err, context.DeadlineExceeded) {
			code = "timeout"
		}
		return fail(code, err)
	}
	sealed, err := box.Seal(pdf, renderFileContext(id))
	if err != nil {
		return err
	}
	if err := s.store.Put(ctx, renderPDF(id), bytes.NewReader(sealed), int64(len(sealed)), files.PDF); err != nil {
		return err
	}
	return s.repo.FinishRender(ctx, id, RenderDone, nil, s.now())
}

// Rendered is a render as the app asks for it: still pending, or its PDF
// (a preview's, with the values' hash Generate needs), or its document.
type Rendered struct {
	State      string
	PDF        []byte
	ValuesHash string
	Document   *Document
}

// GetRender answers reader's render id: pending; a preview's PDF; a
// document's document, made now if its PDF has just come (once: asking again
// answers the same document). ErrRenderFailed when the worker could not
// convert it; ErrNotFound for another's render, or one cleared away.
func (s *Service) GetRender(ctx context.Context, reader Reader, id uuid.UUID) (Rendered, error) {
	r, err := s.repo.GetRender(ctx, id)
	if err != nil {
		return Rendered{}, err
	}
	if r.CreatedBy != reader.ID {
		return Rendered{}, ErrNotFound
	}
	switch r.State {
	case RenderPending:
		return Rendered{State: RenderPending}, nil
	case RenderFailed:
		return Rendered{}, ErrRenderFailed
	case RenderFinished:
		d, err := s.Get(ctx, reader, *r.DocumentID)
		return Rendered{State: RenderFinished, Document: &d}, err
	}
	box, err := s.renderBox(r)
	if err != nil {
		return Rendered{}, err
	}
	pdf, err := s.readSealed(ctx, box, renderPDF(id), renderFileContext(id))
	if err != nil {
		return Rendered{}, err
	}
	if r.Purpose == RenderPreview {
		out := Rendered{State: RenderDone, PDF: pdf}
		if r.ValuesHash != nil {
			out.ValuesHash = *r.ValuesHash
		}
		return out, nil
	}
	filled, err := s.readSealed(ctx, box, renderDocx(id), renderFileContext(id))
	if err != nil {
		return Rendered{}, err
	}
	raw, err := box.Open(r.DataSealed, renderDataContext(id))
	if err != nil {
		return Rendered{}, fmt.Errorf("%w: a render's document does not open", ErrDamaged)
	}
	var p pendingDocument
	if err := gob.NewDecoder(bytes.NewReader(raw)).Decode(&p); err != nil {
		return Rendered{}, err
	}
	if err := s.storeRendered(ctx, &p.Document, pdf, filled); err != nil {
		return Rendered{}, err
	}
	docID, err := s.repo.CompleteRender(ctx, id, p.Document, p.Links, p.Event, s.now())
	if err != nil {
		return Rendered{}, err
	}
	d, err := s.Get(ctx, reader, docID)
	return Rendered{State: RenderFinished, Document: &d}, err
}

// storeRendered keeps a rendered document's PDF (its version's main file) and
// filled DOCX (its source), sealed with its key when its type is sealed.
func (s *Service) storeRendered(ctx context.Context, d *Document, pdf, filled []byte) error {
	v := &d.Versions[0]
	sumPDF, sumDocx := sha256.Sum256(pdf), sha256.Sum256(filled)
	v.File.SizeBytes, v.File.SHA256 = int64(len(pdf)), hex.EncodeToString(sumPDF[:])
	v.Source.SizeBytes, v.Source.SHA256 = int64(len(filled)), hex.EncodeToString(sumDocx[:])
	pdfData, docxData := pdf, filled
	if d.Sealed {
		box, err := s.openKey(*d)
		if err != nil {
			return err
		}
		if pdfData, err = box.Seal(pdf, fileContext(v.File.ID)); err != nil {
			return err
		}
		if docxData, err = box.Seal(filled, fileContext(v.Source.ID)); err != nil {
			return err
		}
	}
	if err := s.store.Put(ctx, v.File.ObjectKey, bytes.NewReader(pdfData), int64(len(pdfData)), files.PDF); err != nil {
		return fmt.Errorf("vault: storing file: %w", err)
	}
	if err := s.store.Put(ctx, v.Source.ObjectKey, bytes.NewReader(docxData), int64(len(docxData)), files.DOCX); err != nil {
		return fmt.Errorf("vault: storing file: %w", err)
	}
	return nil
}

// PurgeRenders removes renders older than an hour, with their files, for the
// upkeep; it answers how many.
func (s *Service) PurgeRenders(ctx context.Context, logger *slog.Logger) (int, error) {
	ids, err := s.repo.StaleRenders(ctx, s.now().Add(-renderMaxAge))
	if err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		if s.store != nil {
			for _, key := range []string{renderDocx(id), renderPDF(id)} {
				if err := s.store.Delete(ctx, key); err != nil && !errors.Is(err, files.ErrNotFound) {
					logger.Warn("render file not deleted", slog.String("render", id.String()), slog.Any("error", err))
				}
			}
		}
		if err := s.repo.DeleteRender(ctx, id); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}
