import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// A published app (ADR 0006): its build is relative (base './'), and the
// API's page names where it is mounted (a channel or version under
// /apps/<slug>/) and where its files are (@ppe/routing's basePath and
// filesBase). In development it is mounted at /apps/<slug>/: open it through
// the staff app's dev server (http://localhost:5180/apps/<slug>/), which
// proxies it here, so the apps share the sign-in cookie, as behind Caddy.
// Its slug and dev port are public/ppe-app.json's, which the staff app's
// proxy, the e2e servers, the web image and the deploy read too.
const manifest = JSON.parse(readFileSync(new URL('./public/ppe-app.json', import.meta.url), 'utf8')) as { slug: string; devPort: number }

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const target = env['VITE_API_TARGET'] ?? 'http://localhost:8090'
  return {
    base: command === 'build' ? './' : `/apps/${manifest.slug}/`,
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      // PORT, when a tool that runs dev servers assigns one; else the app's own.
      port: Number(process.env['PORT'] ?? manifest.devPort),
      strictPort: true,
      proxy: { '/api': { target, changeOrigin: false }, '/health': target, '/ready': target },
    },
    test: { environment: 'jsdom', globals: true },
  }
})
