package docx

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// ErrNoOffice is a worker without LibreOffice (soffice).
var ErrNoOffice = errors.New("docx: soffice is not installed")

// Converter turns a filled DOCX into a PDF with LibreOffice (soffice
// --headless --convert-to pdf), in a folder and a LibreOffice profile of its
// own per call, removed after; cancelling ctx kills soffice and its children.
type Converter struct{}

// Convert is data, a DOCX, as a PDF.
func (Converter) Convert(ctx context.Context, data []byte) ([]byte, error) {
	path, err := exec.LookPath("soffice")
	if err != nil {
		return nil, ErrNoOffice
	}
	dir, err := os.MkdirTemp("", "docx-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	in := filepath.Join(dir, "document.docx")
	if err := os.WriteFile(in, data, 0o600); err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(ctx, path, "--headless", "--norestore", "--nologo", "--nodefault", "--nolockcheck",
		"-env:UserInstallation=file://"+filepath.ToSlash(filepath.Join(dir, "profile")),
		"--convert-to", "pdf:writer_pdf_Export", "--outdir", dir, in)
	cmd.Dir = dir
	// LibreOffice writes its profile and caches under HOME; the worker's root is read-only.
	cmd.Env = append(os.Environ(), "HOME="+dir, "TMPDIR="+dir)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	cmd.Stdout = &stderr
	cmd.WaitDelay = 5 * time.Second
	ownGroup(cmd)
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		line, _, _ := strings.Cut(strings.TrimSpace(stderr.String()), "\n")
		return nil, fmt.Errorf("soffice: %v: %.120s", err, line)
	}
	pdf, err := os.ReadFile(filepath.Join(dir, "document.pdf"))
	if err != nil {
		line, _, _ := strings.Cut(strings.TrimSpace(stderr.String()), "\n")
		return nil, fmt.Errorf("soffice made no PDF: %.120s", line)
	}
	if !bytes.HasPrefix(pdf, []byte("%PDF-")) {
		return nil, errors.New("soffice made no PDF")
	}
	return pdf, nil
}

// Version is soffice's version, or "" without it, for the worker's heartbeat.
func Version(ctx context.Context) string {
	path, err := exec.LookPath("soffice")
	if err != nil {
		return ""
	}
	vctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	b, err := exec.CommandContext(vctx, path, "--headless", "--version").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(strings.SplitN(string(b), "\n", 2)[0])
}
