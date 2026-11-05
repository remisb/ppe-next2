import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// By path: Vite bundles a config's relative imports (see apps/sim-scan's).
import { fixedApps } from '../../packages/launcher/src/published-apps.ts'

// App Launcher is mounted at /apps/ (launcherBase in @ppe/routing, and
// deploy/Caddyfile). Open it through the staff app's dev server,
// http://localhost:5180/apps/, which proxies /apps here: one origin, so the
// apps share the sign-in cookie, as behind Caddy.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const target = env['VITE_API_TARGET'] ?? 'http://localhost:8090'
  return {
    base: '/apps/',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      // PORT, when a tool that runs dev servers assigns one; else the app's own.
      port: Number(process.env['PORT'] ?? fixedApps.launcher),
      strictPort: true,
      proxy: { '/api': { target, changeOrigin: false }, '/health': target, '/ready': target },
    },
    test: { environment: 'jsdom', globals: true },
  }
})
