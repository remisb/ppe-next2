import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// By path, not '@ppe/sim-scan/reader-files': Vite bundles a config's relative
// imports, while a package's TypeScript would reach Node unbundled.
import { serveReaderFiles } from '../../packages/sim-scan/src/reader-files.ts'

// Scan SIMs, the trial, is a published app (ADR 0006, phase 3): its build is
// relative (base './'), and the API's page names where it is mounted (a
// channel or version under /apps/sim-scan/) and where its files are
// (@ppe/routing's basePath and filesBase); public/ppe-app.json declares what
// it needs (the device profile). In development it is mounted at
// /apps/sim-scan/: open it through the staff app's dev server,
// http://localhost:5180/apps/sim-scan/, which proxies it here: one origin, so
// the apps share the sign-in cookie, as behind Caddy. The readers' files are
// served at /apps/sim-scan/readers/ (serveReaderFiles). A phone's camera needs
// a secure address: VITE_HTTPS=1 serves this port over https with a throwaway
// certificate, on the LAN, to try it on a phone (https://<this machine>:5184/apps/sim-scan/).
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const target = env['VITE_API_TARGET'] ?? 'http://localhost:8090'
  const https = env['VITE_HTTPS'] === '1'
  return {
    base: command === 'build' ? './' : '/apps/sim-scan/',
    plugins: [react(), tailwindcss(), serveReaderFiles(), ...(https ? [basicSsl()] : [])],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      // PORT, when a tool that runs dev servers assigns one; else the app's own.
      port: Number(process.env['PORT'] ?? 5184),
      strictPort: true,
      host: https,
      proxy: { '/api': { target, changeOrigin: false }, '/health': target, '/ready': target },
    },
    test: { environment: 'jsdom', globals: true },
  }
})
