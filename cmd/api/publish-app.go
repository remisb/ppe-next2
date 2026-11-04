package main

import (
	"archive/tar"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/remisb/ppe-next2/internal/domain/launcher"
)

// The most a published build may hold: Scan SIMs' readers are about 15 MB.
const (
	maxBuildBytes = 300 << 20
	maxBuildFiles = 5000
)

// publishApp publishes an app's build, a tar of its dist/ read from in (the
// API's image has no shell, so the build arrives on standard input): the
// files go to API_APPS_DIR/<profile>/<slug>/<version>/, unless that version
// is published already, then the version is recorded and -channel pointed at
// it (launcher.Service.Publish). A deploy's publish is recorded by no one.
func publishApp(ctx context.Context, svc services, cfg config, in io.Reader, out io.Writer) error {
	incoming := filepath.Join(cfg.AppsDir, ".incoming")
	if err := os.MkdirAll(incoming, 0o755); err != nil {
		return err
	}
	tmp, err := os.MkdirTemp(incoming, cfg.PublishApp+"-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	if err := untar(in, tmp); err != nil {
		return fmt.Errorf("the build: %w", err)
	}
	raw, err := os.ReadFile(filepath.Join(tmp, "ppe-app.json"))
	if err != nil {
		return errors.New("the build has no ppe-app.json")
	}
	if _, err := os.Stat(filepath.Join(tmp, "index.html")); err != nil {
		return errors.New("the build has no index.html")
	}
	var m launcher.Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return fmt.Errorf("ppe-app.json: %w", err)
	}
	p := launcher.PublishParams{Slug: cfg.PublishApp, Version: cfg.PublishVersion, Commit: cfg.PublishCommit, Channel: cfg.PublishChannel, Manifest: m}
	if _, err := svc.launcher.CheckPublish(ctx, p); err != nil {
		return err
	}
	profile, err := launcher.ProfileOf(m.Capabilities)
	if err != nil {
		return err
	}
	_, found, err := svc.launcher.Version(ctx, p.Slug, p.Version)
	if err != nil {
		return err
	}
	if !found {
		dest := filepath.Join(cfg.AppsDir, string(profile), p.Slug, p.Version)
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		// A folder no version names was left by a publish that failed before it was recorded.
		if err := os.RemoveAll(dest); err != nil {
			return err
		}
		if err := os.Rename(tmp, dest); err != nil {
			return err
		}
		// Caddy, another user, reads the files.
		if err := os.Chmod(dest, 0o755); err != nil {
			return err
		}
	}
	v, err := svc.launcher.Publish(ctx, p, nil)
	if err != nil {
		return err
	}
	state := "published"
	if found {
		state = "already published"
	}
	channel := ""
	if p.Channel != "" {
		channel = ", " + p.Channel + " points at it"
	}
	_, err = fmt.Fprintf(out, "%s %s %s (%s)%s\n", p.Slug, v.Version, state, v.Profile, channel)
	return err
}

// untar writes the tar's directories and regular files under dir: no
// absolute names, none outside dir, no links or devices, within the limits.
func untar(in io.Reader, dir string) error {
	tr := tar.NewReader(in)
	var total int64
	files := 0
	for {
		h, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		name := path.Clean(strings.TrimPrefix(h.Name, "./"))
		if name == "." {
			continue
		}
		if path.IsAbs(name) || name == ".." || strings.HasPrefix(name, "../") {
			return fmt.Errorf("%q is outside the build", h.Name)
		}
		target := filepath.Join(dir, filepath.FromSlash(name))
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if files++; files > maxBuildFiles {
				return fmt.Errorf("more than %d files", maxBuildFiles)
			}
			if total += h.Size; total > maxBuildBytes {
				return fmt.Errorf("larger than %d MB", maxBuildBytes>>20)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
			if err != nil {
				return err
			}
			_, err = io.Copy(f, io.LimitReader(tr, h.Size))
			if cerr := f.Close(); err == nil {
				err = cerr
			}
			if err != nil {
				return err
			}
		default:
			return fmt.Errorf("%q is not a file or a folder", h.Name)
		}
	}
}
