---
paths:
  - "web/e2e/**"
  - "deploy/Caddyfile"
  - ".github/workflows/**"
---

# End-to-end rules (`web/e2e`)

One serial spec drives the whole lifecycle through the real UI, API and a `*_test`
database. Playwright starts its web servers before global setup, so the API's command
first runs `web/e2e/prepare-db.ts` (empties the database, gives `ppe_app` its test password:
the API connects as it); global setup then seeds a test admin via `api -seed-admin`. Run
`pnpm exec playwright install chromium` once. It waits while another e2e run (or `pnpm guide`)
holds the test database's lock (CLAUDE.md, "One e2e run at a time").
The web server is Vite by default. With `E2E_WEB_SERVER=caddy` (which CI uses), it serves
the `pnpm build` output through `deploy/Caddyfile`, the production proxy config. That mode
needs `caddy` on your `PATH`, or `make e2e-caddy`, which runs it from Docker (`E2E_CADDY=docker`).
In it, global setup publishes each published app's fresh build as `2026.01.01-e2e` into a temp folder
(`ppe-next2-e2e-published`), which `prepare-db.ts` empties first, as it empties the database. CI pins the Caddy version and its SHA-512 checksum in
`ci.yml`, so a Caddy upgrade must update both, and `web/Dockerfile`'s `CADDY_VERSION`, the
production image's (`TestWebImageRunsCIsCaddy` keeps them equal).
The Vite web servers are started from `apps/<app>/node_modules/.bin/vite`, not `pnpm exec`:
pnpm 12 detaches the child, so Playwright could not stop it and the run hung after the last test.
With Vite, Administration runs on 5183 and the staff app's server proxies `/admin` to it, so
tests open it at `webURL/admin/` on one origin, as behind Caddy.

