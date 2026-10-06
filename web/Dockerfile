# The staff app and Administration, built and baked into the Caddy image that
# serves them, so a deploy replaces the files and the proxy config in one step.
# Build context: the web/ directory.
FROM node:22-alpine AS build
RUN npm install -g pnpm@12.6.0
WORKDIR /web
COPY . .
# Only the apps and their workspace packages: not e2e, which pulls in Playwright.
RUN pnpm install --frozen-lockfile --filter @ppe/workwear... --filter @ppe/admin... \
 && pnpm --filter @ppe/workwear --filter @ppe/admin build

FROM caddy:2-alpine
COPY --from=build /web/apps/workwear/dist /srv/workwear/dist
COPY --from=build /web/apps/admin/dist /srv/admin/dist
