import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// The spike's dev server: the page, its readers at /readers/ (tesseract.js's
// worker and cores from node_modules, the models from .models/) and the
// generated photos at /photos/ (.photos/). Port 5189, clear of the apps'
// 5180–5187 and PPE-next's. --host serves it on the LAN, for a phone.
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const require = createRequire(import.meta.url)
function dir(pkg: string): string {
  let d = dirname(require.resolve(pkg))
  while (!existsSync(join(d, 'package.json')) || (JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')) as { name?: string }).name !== pkg) d = dirname(d)
  return d
}

const types: Record<string, string> = { js: 'text/javascript', gz: 'application/gzip', json: 'application/json', jpg: 'image/jpeg', png: 'image/png' }

function readerFile(name: string): string | undefined {
  if (name === 'worker.min.js') return join(dir('tesseract.js'), 'dist/worker.min.js')
  if (/^tesseract-core[\w-]*\.wasm\.js$/.test(name)) return join(dir('tesseract.js-core'), name)
  if (/^\w+\.traineddata\.gz$/.test(name)) return here(`./.models/${name}`)
  return undefined
}

export default defineConfig({
  plugins: [
    {
      name: 'mrz-spike-files',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = (req.url ?? '').split('?')[0]!
          const path = url.startsWith('/readers/') ? readerFile(url.slice(9)) : url.startsWith('/photos/') && !url.includes('..') ? here(`./.photos/${url.slice(8)}`) : undefined
          if (!path || !existsSync(path)) return next()
          res.setHeader('Content-Type', types[path.split('.').pop()!] ?? 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-store')
          res.end(readFileSync(path))
        })
      },
    },
  ],
  worker: { format: 'es' as const },
  server: { port: Number(process.env['PORT'] ?? 5189), strictPort: true },
  test: { environment: 'node', globals: true, include: ['src/**/*.test.ts'] },
})
