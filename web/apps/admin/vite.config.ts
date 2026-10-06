import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Administration is mounted at /admin/ (adminBase in @ppe/routing, and
// deploy/Caddyfile). Open it through the staff app's dev server,
// http://localhost:5180/admin/, which proxies /admin here: one origin, so the
// two apps share the sign-in cookie, as they do behind Caddy. On its own port
// it proxies /api as the staff app does, keeping the browser's Host header for
// the sign-in routes' Origin check.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const target = env['VITE_API_TARGET'] ?? 'http://localhost:8090'
  return {
    base: '/admin/',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { port: 5182, strictPort: true, proxy: { '/api': { target, changeOrigin: false }, '/health': target } },
    test: { environment: 'jsdom', globals: true },
  }
})
