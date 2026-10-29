/**
 * The readers' own files, served from the app's origin at <base>readers/
 * (the Content-Security-Policy allows no other host): the barcode reader's
 * WebAssembly, the text reader's worker, its cores (the worker loads the one
 * the browser can run) and its English data. A Vite plugin for the app's
 * vite.config.ts: in development it serves them from node_modules, in a build
 * it writes them into dist. Their names never change, so they sit outside
 * /assets, which is cached for good (deploy/Caddyfile).
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)

/** An installed package's folder: up from its entry to its package.json (not every package exports that file). */
function dir(pkg: string): string {
  let d = dirname(require.resolve(pkg))
  while (!existsSync(join(d, 'package.json')) || (JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')) as { name?: string }).name !== pkg) {
    const up = dirname(d)
    if (up === d) throw new Error(`reader-files: ${pkg} is not installed`)
    d = up
  }
  return d
}

/** Each file as served, and where it is installed. */
export function readerFiles(): Record<string, string> {
  const core = dir('tesseract.js-core')
  return {
    'zxing_reader.wasm': join(dir('zxing-wasm'), 'dist/reader/zxing_reader.wasm'),
    'worker.min.js': join(dir('tesseract.js'), 'dist/worker.min.js'),
    'tesseract-core-relaxedsimd-lstm.wasm.js': join(core, 'tesseract-core-relaxedsimd-lstm.wasm.js'),
    'tesseract-core-simd-lstm.wasm.js': join(core, 'tesseract-core-simd-lstm.wasm.js'),
    'tesseract-core-lstm.wasm.js': join(core, 'tesseract-core-lstm.wasm.js'),
    'eng.traineddata.gz': join(dir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'),
  }
}

const types: Record<string, string> = { wasm: 'application/wasm', js: 'text/javascript', gz: 'application/gzip' }

interface DevServer {
  config: { base: string }
  middlewares: { use(fn: (req: { url?: string }, res: DevResponse, next: () => void) => void): void }
}
interface DevResponse {
  setHeader(name: string, value: string): void
  end(body: Buffer): void
}
interface EmitContext {
  emitFile(file: { type: 'asset'; fileName: string; source: Uint8Array }): string
}

/** The Vite plugin: the files at <base>readers/<name>. */
export function serveReaderFiles() {
  const files = readerFiles()
  return {
    name: 'ppe-sim-scan-reader-files',
    configureServer(server: DevServer) {
      const prefix = `${server.config.base}readers/`
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.startsWith(prefix) ? req.url.split('?')[0]!.slice(prefix.length) : undefined
        const path = name === undefined ? undefined : files[name]
        if (!path) return next()
        res.setHeader('Content-Type', types[name!.split('.').pop()!] ?? 'application/octet-stream')
        res.end(readFileSync(path))
      })
    },
    generateBundle(this: EmitContext) {
      for (const [name, path] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `readers/${name}`, source: readFileSync(path) })
      }
    },
  }
}
