# The staff app, Administration and App Launcher, built and baked into the Caddy image that
# serves them, so a deploy replaces the files and the proxy config in one step.
# Every published app (ADR 0006: an apps/<slug> with public/ppe-app.json, such
# as Scan SIMs) rides along at /srv/build/<slug> for `make prod-up` to
# publish, and is served from the published volume; none is named here.
# `make prod-publish` builds one app at another commit with the app-dist
# stage. Build context: the web/ directory.
FROM node:22-alpine AS build
RUN npm install -g pnpm@12.6.0
WORKDIR /web
# The packages first, from the lockfile alone, so this layer is reused until a
# dependency changes. pnpm-workspace.yaml holds settings the install obeys.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY . .
# Every app in apps/ and its workspace packages: not e2e, which pulls in
# Playwright. Linked from the store fetched above, so offline and quick. vite
# build only: CI's web job typechecks (`pnpm typecheck`, `pnpm build`), so tsc
# is not run again on the droplet. Then each published app's dist/ goes to
# /out/build/<slug>.
RUN pnpm install --offline --frozen-lockfile --filter "{./apps/*}..." \
 && pnpm --filter "{./apps/*}" exec vite build \
 && mkdir -p /out/build \
 && for m in apps/*/public/ppe-app.json; do \
      [ -e "$m" ] || continue; app="${m%/public/ppe-app.json}"; cp -R "$app/dist" "/out/build/${app#apps/}"; \
    done

# One app's dist/ alone: docker build --target app-dist --build-arg APP=<dir> --output …
FROM scratch AS app-dist
ARG APP=sim-scan
COPY --from=build /web/apps/${APP}/dist /

FROM caddy:2-alpine
COPY --from=build /web/apps/workwear/dist /srv/workwear/dist
COPY --from=build /web/apps/admin/dist /srv/admin/dist
COPY --from=build /web/apps/launcher/dist /srv/launcher/dist
COPY --from=build /out/build /srv/build
