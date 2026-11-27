package main

import (
	"context"
	"io"

	"github.com/remisb/applauncher/releases"
)

// publishApp is api -publish-app: the build, a tar of its dist/ on in,
// published into API_APPS_DIR as -version, -channel pointed at it
// (releases.Publish).
func publishApp(ctx context.Context, svc services, cfg config, in io.Reader, out io.Writer) error {
	b := releases.Build{Slug: cfg.PublishApp, Version: cfg.PublishVersion, Commit: cfg.PublishCommit, Channel: cfg.PublishChannel}
	return releases.Publish(ctx, svc.launcher, releasesConfig(cfg), b, in, out)
}

// pruneApps is api -prune-apps: old versions no channel opens, and folders
// no version names, removed (releases.Prune).
func pruneApps(ctx context.Context, svc services, cfg config, out io.Writer) error {
	return releases.Prune(ctx, svc.launcher, releasesConfig(cfg), out)
}
