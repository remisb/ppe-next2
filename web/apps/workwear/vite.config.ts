import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// By path: Vite bundles a config's relative imports (see apps/sim-scan's).
import { publishedApps, targetEnv } from '../../packages/launcher/src/published-apps.ts'

// The dev server proxies /api to the Go API so the browser sees one origin and
// no CORS is needed. VITE_API_TARGET in .env.local overrides the target, e.g.
// another port when 8090 is taken. The proxy keeps the browser's Host header
// (Vite's shorthand would rewrite it to the target's): the sign-in routes accept
// an Origin that matches it, whatever port this server runs on.
//
// /admin goes to Administration's dev server (apps/admin, port 5182;
// VITE_ADMIN_TARGET overrides it), websocket and all for its hot reload, so
// both apps are on this one origin and share the sign-in, as behind Caddy.
// /apps/<slug> goes to each published app's dev server (every apps/<slug> with
// a public/ppe-app.json, on its devPort: Scan SIMs' 5184;
// VITE_APP_<SLUG>_TARGET, such as VITE_APP_SIM_SCAN_TARGET, overrides it) for
// the same reason, and the rest of /apps to App Launcher's (apps/launcher, port
// 5186; VITE_LAUNCHER_TARGET overrides it). Behind Caddy the API answers a
// published app's page instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const target = env['VITE_API_TARGET'] ?? 'http://localhost:8090'
  const admin = env['VITE_ADMIN_TARGET'] ?? 'http://localhost:5182'
  const launcher = env['VITE_LAUNCHER_TARGET'] ?? 'http://localhost:5186'
  const published = publishedApps(fileURLToPath(new URL('../..', import.meta.url))).map((a) => [
    `/apps/${a.slug}`,
    { target: env[targetEnv(a.slug)] ?? `http://localhost:${a.devPort}`, changeOrigin: false, ws: true },
  ])
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5180,
      strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: false },
        '/health': target,
        '/ready': target,
        '/admin': { target: admin, changeOrigin: false, ws: true },
        // Before /apps: the first rule that matches is used.
        ...Object.fromEntries(published),
        // '/apps/' and '/apps' exactly, not every path that starts with "apps".
        '^/apps(/|$)': { target: launcher, changeOrigin: false, ws: true },
      },
    },
    test: { environment: 'jsdom', globals: true },
  }
})
