# The workwear app, built and baked into the Caddy image that serves it, so a
# deploy replaces the files and the proxy config in one step. Build context:
# the web/ directory.
FROM node:22-alpine AS build
RUN npm install -g pnpm@12.6.0
WORKDIR /web
COPY . .
# Only the app and its workspace packages: not e2e, which pulls in Playwright.
RUN pnpm install --frozen-lockfile --filter @ppe/workwear... && pnpm --filter @ppe/workwear build

FROM caddy:2-alpine
COPY --from=build /web/apps/workwear/dist /srv/workwear/dist
