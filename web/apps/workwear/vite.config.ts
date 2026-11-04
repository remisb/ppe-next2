import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// The dev server proxies /api to the Go API so the browser sees one origin and
// no CORS is needed. VITE_API_TARGET in .env.local overrides the target, e.g.
// another port when 8090 is taken. The proxy keeps the browser's Host header
// (Vite's shorthand would rewrite it to the target's): the sign-in routes accept
// an Origin that matches it, whatever port this server runs on.
//
// /admin goes to Administration's dev server (apps/admin, port 5182;
// VITE_ADMIN_TARGET overrides it), websocket and all for its hot reload, so
// both apps are on this one origin and share the sign-in, as behind Caddy.
// /apps/sim-scan goes to the Scan SIMs trial's (apps/sim-scan, port 5184;
// VITE_SIM_SCAN_TARGET overrides it) for the same reason, and the rest of /apps
// to App Launcher's (apps/launcher, port 5186; VITE_LAUNCHER_TARGET overrides
// it). Behind Caddy the API answers a published app's page instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const target = env['VITE_API_TARGET'] ?? 'http://localhost:8090'
  const admin = env['VITE_ADMIN_TARGET'] ?? 'http://localhost:5182'
  const simScan = env['VITE_SIM_SCAN_TARGET'] ?? 'http://localhost:5184'
  const launcher = env['VITE_LAUNCHER_TARGET'] ?? 'http://localhost:5186'
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
        '/apps/sim-scan': { target: simScan, changeOrigin: false, ws: true },
        // '/apps/' and '/apps' exactly, not every path that starts with "apps".
        '^/apps(/|$)': { target: launcher, changeOrigin: false, ws: true },
      },
    },
    test: { environment: 'jsdom', globals: true },
  }
})
