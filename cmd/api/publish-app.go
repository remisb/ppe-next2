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
	"time"

	"github.com/remisb/ppe-next2/internal/domain/launcher"
)

// The most a published build may hold: Scan SIMs' readers are about 15 MB.
const (
	maxBuildBytes = 300 << 20
	maxBuildFiles = 5000
)

// publishApp publishes an app's build, a tar of its dist/ read from in (the
// API's image has no shell, so the build arrives on standard input): the
// files go to API_APPS_DIR/<profile>/<slug>/<version>/ unless they are there
// already, then the version is recorded and -channel pointed at it
// (launcher.Service.Publish). A deploy's publish is recorded by no one.
//
// The files are decided by the folder, not the registry: the published
// volume is not backed up, so after a restore or a lost volume the database
// names versions whose folders are gone, and publishing the same commit
// again (make prod-up, make prod-publish) puts them back.
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
	recorded, found, err := svc.launcher.Version(ctx, p.Slug, p.Version)
	if err != nil {
		return err
	}
	if found && recorded.Profile != profile {
		return fmt.Errorf("version %s is recorded with the %s profile, this build asks for %s", p.Version, recorded.Profile, profile)
	}
	dest := filepath.Join(cfg.AppsDir, string(profile), p.Slug, p.Version)
	wrote, err := placeBuild(tmp, dest)
	if err != nil {
		return err
	}
	v, err := svc.launcher.Publish(ctx, p, nil)
	if err != nil {
		return err
	}
	state := "published"
	switch {
	case found && wrote:
		state = "published again: its files were missing"
	case found:
		state = "already published"
	}
	channel := ""
	if p.Channel != "" {
		channel = ", " + p.Channel + " points at it"
	}
	_, err = fmt.Fprintf(out, "%s %s %s (%s)%s\n", p.Slug, v.Version, state, v.Profile, channel)
	return err
}

// placeBuild moves the unpacked build at tmp to dest, unless dest holds a
// build already (its index.html; a build is moved in whole, so a folder with
// one is complete), and says whether it did. A folder without one is a
// leftover and is replaced. Two publishes of one version at once: the second
// finds the first's folder, complete, and keeps it.
func placeBuild(tmp, dest string) (bool, error) {
	if complete(dest) {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return false, err
	}
	if err := os.RemoveAll(dest); err != nil {
		return false, err
	}
	if err := os.Rename(tmp, dest); err != nil {
		if complete(dest) {
			return false, nil
		}
		return false, err
	}
	// Caddy, another user, reads the files.
	return true, os.Chmod(dest, 0o755)
}

func complete(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, "index.html"))
	return err == nil && info.Mode().IsRegular()
}

// staleAfter is how old a folder no version names must be before -prune-apps
// removes it: a publish moves its folder into place a moment before it
// records the version, and one may be running beside the prune.
const staleAfter = time.Hour

// pruneApps removes the versions launcher.Service.Prune drops from the
// registry, then their files; then what no version names: a killed publish's
// folder under .incoming/, and a version folder the registry does not know
// (which Caddy would otherwise go on serving). A folder that will not go is
// reported, not fatal.
func pruneApps(ctx context.Context, svc services, cfg config, out io.Writer) error {
	removed, err := svc.launcher.Prune(ctx)
	if err != nil {
		return err
	}
	for _, p := range removed {
		dir := filepath.Join(cfg.AppsDir, string(p.Version.Profile), p.Slug, p.Version.Version)
		if err := os.RemoveAll(dir); err != nil {
			fmt.Fprintf(out, "%s %s removed; its files stay: %v\n", p.Slug, p.Version.Version, err)
			continue
		}
		fmt.Fprintf(out, "%s %s removed\n", p.Slug, p.Version.Version)
	}
	if len(removed) == 0 {
		fmt.Fprintln(out, "no published version to remove")
	}
	recorded, err := svc.launcher.Recorded(ctx)
	if err != nil {
		return err
	}
	known := map[string]bool{}
	for _, r := range recorded {
		known[filepath.Join(string(r.Version.Profile), r.Slug, r.Version.Version)] = true
	}
	var stray []string
	if dirs, err := filepath.Glob(filepath.Join(cfg.AppsDir, ".incoming", "*")); err == nil {
		stray = append(stray, dirs...)
	}
	for _, profile := range []launcher.Profile{launcher.ProfileStandard, launcher.ProfileDevice} {
		dirs, _ := filepath.Glob(filepath.Join(cfg.AppsDir, string(profile), "*", "*"))
		for _, dir := range dirs {
			if rel, _ := filepath.Rel(cfg.AppsDir, dir); !known[rel] {
				stray = append(stray, dir)
			}
		}
	}
	for _, dir := range stray {
		info, err := os.Stat(dir)
		if err != nil || time.Since(info.ModTime()) < staleAfter {
			continue
		}
		rel, _ := filepath.Rel(cfg.AppsDir, dir)
		if err := os.RemoveAll(dir); err != nil {
			fmt.Fprintf(out, "%s, which no version names, stays: %v\n", rel, err)
			continue
		}
		fmt.Fprintf(out, "%s, which no version names, removed\n", rel)
	}
	return nil
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
