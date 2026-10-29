import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// By path, not '@ppe/sim-scan/reader-files': Vite bundles a config's relative
// imports, while a package's TypeScript would reach Node unbundled.
import { serveReaderFiles } from '../../packages/sim-scan/src/reader-files.ts'

// Scan SIMs, the trial, is mounted at /sim-scan/ (simScanBase in @ppe/routing,
// and deploy/Caddyfile). Open it through the staff app's dev server,
// http://localhost:5180/sim-scan/, which proxies /sim-scan here: one origin, so
// the apps share the sign-in cookie, as behind Caddy. The readers' files are
// served at /sim-scan/readers/ (serveReaderFiles). A phone's camera needs a
// secure address: VITE_HTTPS=1 serves this port over https with a throwaway
// certificate, on the LAN, to try it on a phone (https://<this machine>:5184/sim-scan/).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const target = env['VITE_API_TARGET'] ?? 'http://localhost:8090'
  const https = env['VITE_HTTPS'] === '1'
  return {
    base: '/sim-scan/',
    plugins: [react(), tailwindcss(), serveReaderFiles(), ...(https ? [basicSsl()] : [])],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5184,
      strictPort: true,
      host: https,
      proxy: { '/api': { target, changeOrigin: false }, '/health': target, '/ready': target },
    },
    test: { environment: 'jsdom', globals: true },
  }
})
