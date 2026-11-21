import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// By path, not '@ppe/mrz/reader-files': Vite bundles a config's relative
// imports, while a package's TypeScript would reach Node unbundled. It lists
// the text reader's files and the OCR-B model, served at <base>readers/.
import { serveMrzReaderFiles } from '../../packages/mrz/src/reader/reader-files.ts'

// A published app (ADR 0006): its build is relative (base './'), and the
// API's page names where it is mounted (a channel or version under
// /apps/<slug>/) and where its files are (@ppe/routing's basePath and
// filesBase). In development it is mounted at /apps/<slug>/: open it through
// the staff app's dev server (http://localhost:5180/apps/<slug>/), which
// proxies it here, so the apps share the sign-in cookie, as behind Caddy.
// Its slug and dev port are public/ppe-app.json's, which the staff app's
// proxy, the e2e servers, the web image and the deploy read too; it has the
// device profile (WebAssembly and workers for the MRZ reader, the camera). A
// phone's camera needs a secure address: VITE_HTTPS=1 serves this port over
// https with a throwaway certificate, on the LAN.
const manifest = JSON.parse(readFileSync(new URL('./public/ppe-app.json', import.meta.url), 'utf8')) as { slug: string; devPort: number }

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const target = env['VITE_API_TARGET'] ?? 'http://localhost:8090'
  const https = env['VITE_HTTPS'] === '1'
  return {
    base: command === 'build' ? './' : `/apps/${manifest.slug}/`,
    plugins: [react(), tailwindcss(), serveMrzReaderFiles(), ...(https ? [basicSsl()] : [])],
    // The MRZ reader's image worker (@ppe/mrz's reader/image.worker.ts) is a module worker, built as one.
    worker: { format: 'es' as const },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      // PORT, when a tool that runs dev servers assigns one; else the app's own.
      port: Number(process.env['PORT'] ?? manifest.devPort),
      strictPort: true,
      host: https,
      proxy: { '/api': { target, changeOrigin: false }, '/health': target, '/ready': target },
    },
    test: { environment: 'jsdom', globals: true },
  }
})
