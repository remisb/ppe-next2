package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/remisb/ppe-next2/internal/outbox"
	vaultdoc "github.com/remisb/ppe-next2/internal/vault/document"
	"github.com/remisb/ppe-next2/internal/vault/extract"
)

// workerAliveFile is touched after each heartbeat the worker records; the
// docworker's healthcheck (-healthcheck-worker) reads its time.
func workerAliveFile() string { return filepath.Join(os.TempDir(), "ppe-worker-alive") }

// runWorker is `api -worker` (ADR 0008 decision 9, docs/specs/outbox-service.md):
// the same binary as the API, in the docworker image with the tools. It
// probes its tools, serves the kinds they allow, and runs until stopped.
func runWorker(ctx context.Context, svc services, cfg config, logger *slog.Logger) error {
	tools := extract.Tools(ctx)
	handlers := map[string]outbox.Handler{}
	if svc.vault != nil && extract.Ready(tools) {
		vaultdoc.WithTextReader(extract.Reader{MaxPages: cfg.WorkerMaxPages})(svc.vault)
		handlers[vaultdoc.KindReadText] = readTextHandler(svc.vault)
	}
	// Archiving needs no tool, only the files store (phase 6).
	if svc.vault != nil && cfg.FilesTarget != "" {
		handlers[vaultdoc.KindArchive] = archiveHandler(svc.vault)
	}
	if _, ok := handlers[vaultdoc.KindReadText]; !ok {
		logger.Warn("the worker reads no document's text: its tools are missing (pdftotext, pdftoppm, tesseract with eng, lit, rus and osd)",
			slog.Any("tools", tools))
	}
	if _, ok := handlers[vaultdoc.KindArchive]; !ok {
		logger.Warn("the worker archives no record: there is no file storage (API_FILES_TARGET)")
	}
	host, _ := os.Hostname()
	if host == "" {
		host = "worker"
	}
	r := &outbox.Runner{
		Queue:       svc.outbox,
		Handlers:    handlers,
		Worker:      outbox.Worker{Name: fmt.Sprintf("%s-%d", host, os.Getpid()), Version: buildCommit(), Tools: tools},
		Concurrency: cfg.WorkerConcurrency,
		Timeout:     cfg.WorkerJobTimeout,
		Logger:      logger,
		Alive: func() {
			now := time.Now()
			name := workerAliveFile()
			if err := os.Chtimes(name, now, now); errors.Is(err, os.ErrNotExist) {
				err = os.WriteFile(name, nil, 0o600)
				if err != nil {
					logger.Warn("worker cannot write its heartbeat file", slog.Any("error", err))
				}
			}
		},
	}
	logger.Info("worker started", slog.String("name", r.Worker.Name), slog.Any("kinds", r.Kinds()), slog.Any("tools", tools),
		slog.Int("concurrency", cfg.WorkerConcurrency), slog.Duration("job_timeout", cfg.WorkerJobTimeout), slog.String("commit", buildCommit()))
	err := r.Run(ctx)
	logger.Info("worker stopped")
	return err
}

// readTextHandler is vault.extract_text's handler: the version in the payload,
// read; its last attempt records a failure on the version.
func readTextHandler(vault *vaultdoc.Service) outbox.Handler {
	return func(ctx context.Context, j outbox.Job) error {
		var p vaultdoc.ReadTextJob
		if err := json.Unmarshal(j.Payload, &p); err != nil {
			return outbox.Permanent(fmt.Errorf("payload: %w", err))
		}
		return vault.ReadText(ctx, p.Version, j.Attempts >= j.MaxAttempts)
	}
}

// archiveHandler is vault.archive's handler: the record in the payload,
// archived once (docs/specs/vault-service.md, "Archiving").
func archiveHandler(vault *vaultdoc.Service) outbox.Handler {
	return func(ctx context.Context, j outbox.Job) error {
		var p vaultdoc.ArchiveJob
		if err := json.Unmarshal(j.Payload, &p); err != nil {
			return outbox.Permanent(fmt.Errorf("payload: %w", err))
		}
		err := vault.Archive(ctx, p.Source, p.ID)
		if errors.Is(err, vaultdoc.ErrInvalid) {
			// The record cannot be kept as it is: trying again will not mend it.
			return outbox.Permanent(err)
		}
		return err
	}
}

// probeWorker is -healthcheck-worker: healthy while the worker in this
// container recorded a heartbeat within the last 2 minutes.
func probeWorker(out io.Writer) error {
	fi, err := os.Stat(workerAliveFile())
	if err != nil {
		return fmt.Errorf("worker: no heartbeat yet: %w", err)
	}
	if age := time.Since(fi.ModTime()); age > 2*time.Minute {
		return fmt.Errorf("worker: last heartbeat %s ago", age.Round(time.Second))
	}
	fmt.Fprintln(out, "worker alive")
	return nil
}

// vaultReindex is -vault-reindex: a job for every document version still
// waiting for its text (stored before the worker ran), or failed with -failed.
func vaultReindex(ctx context.Context, svc services, failed bool, out io.Writer) error {
	n, err := svc.vault.QueueUnread(ctx, failed)
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "%d document versions queued for reading\n", n)
	return nil
}
