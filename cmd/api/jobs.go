package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/remisb/ppe-next2/internal/security"
)

// purgeEvery is how often the API deletes security events older than their
// retention.
const purgeEvery = time.Hour

// purgeSecurityEvents deletes security events older than
// API_AUTH_EVENTS_RETENTION now and then every purgeEvery, until ctx ends. The
// store holds an advisory lock while it purges, so with several API instances
// one does it. It runs in the API until ADR 0001's worker exists.
func purgeSecurityEvents(ctx context.Context, sec *security.Service, logger *slog.Logger) {
	tick := time.NewTicker(purgeEvery)
	defer tick.Stop()
	for {
		n, err := sec.Purge(ctx)
		switch {
		case err != nil && ctx.Err() == nil:
			logger.Error("security events purge failed", slog.Any("error", err))
		case n > 0:
			logger.Info("security events purged", slog.Int64("deleted", n))
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
