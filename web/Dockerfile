# The staff app, Administration and App Launcher, built and baked into the Caddy image that
# serves them, so a deploy replaces the files and the proxy config in one step.
# Scan SIMs is a published app (ADR 0006, phase 3): its build rides along at
# /srv/build/sim-scan for `make prod-up` to publish, and is served from the
# published volume. `make prod-publish` builds one app at another commit with
# the app-dist stage. Build context: the web/ directory.
FROM node:22-alpine AS build
RUN npm install -g pnpm@12.6.0
WORKDIR /web
# The packages first, from the lockfile alone, so this layer is reused until a
# dependency changes. pnpm-workspace.yaml holds settings the install obeys.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
# Only the apps and their workspace packages: not e2e, which pulls in Playwright.
# Linked from the store fetched above, so offline and quick. vite build only:
# CI's web job typechecks (`pnpm typecheck`, `pnpm build`), so tsc is not run
# again on the droplet.
RUN pnpm install --offline --frozen-lockfile --filter @ppe/workwear... --filter @ppe/admin... --filter @ppe/sim-scan-app... --filter @ppe/launcher-app... \
 && pnpm --filter @ppe/workwear --filter @ppe/admin --filter @ppe/sim-scan-app --filter @ppe/launcher-app exec vite build

# One app's dist/ alone: docker build --target app-dist --build-arg APP=<dir> --output …
FROM scratch AS app-dist
ARG APP=sim-scan
COPY --from=build /web/apps/${APP}/dist /

FROM caddy:2-alpine
COPY --from=build /web/apps/workwear/dist /srv/workwear/dist
COPY --from=build /web/apps/admin/dist /srv/admin/dist
COPY --from=build /web/apps/launcher/dist /srv/launcher/dist
COPY --from=build /web/apps/sim-scan/dist /srv/build/sim-scan
