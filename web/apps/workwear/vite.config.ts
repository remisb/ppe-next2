import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// The dev server proxies /api to the Go API so the browser sees one origin and
// no CORS is needed. VITE_API_TARGET in .env.local overrides the target, e.g.
// another port when 8090 is taken.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')
  const target = env['VITE_API_TARGET'] ?? 'http://localhost:8090'
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { port: 5180, strictPort: true, proxy: { '/api': target, '/health': target } },
    test: { environment: 'jsdom', globals: true },
  }
})
