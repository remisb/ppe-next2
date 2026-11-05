/**
 * The readers' own files, served from the app's origin at <base>readers/ (the
 * Content-Security-Policy allows no other host): the barcode reader's
 * WebAssembly, the text reader's worker and cores (the worker loads the one
 * the browser can run) and a model. A Vite plugin for an app's vite.config.ts:
 * in development it serves them from node_modules, in a build it writes them
 * into dist. Their names never change, so they sit outside /assets, which is
 * cached for good (deploy/Caddyfile).
 *
 * An app imports this file by path, not as '@ppe/scan-kit/reader-files': Vite
 * bundles a config's relative imports, while a package's TypeScript would reach
 * Node unbundled.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** An installed package's folder, resolved as from would import it: up from its entry to its package.json (not every package exports that file). */
export function packageDir(pkg: string, from: string | URL = import.meta.url): string {
  const require = createRequire(from)
  let d = dirname(require.resolve(pkg))
  while (!existsSync(join(d, 'package.json')) || (JSON.parse(readFileSync(join(d, 'package.json'), 'utf8')) as { name?: string }).name !== pkg) {
    const up = dirname(d)
    if (up === d) throw new Error(`reader-files: ${pkg} is not installed`)
    d = up
  }
  return d
}

/** The barcode reader's WebAssembly (barcodes.ts), as served and where it is installed. */
export function barcodeReaderFiles(): Record<string, string> {
  return { 'zxing_reader.wasm': join(packageDir('zxing-wasm'), 'dist/reader/zxing_reader.wasm') }
}

/** The text reader's worker and cores (text-reader.ts); the model is the app's own. */
export function textReaderFiles(): Record<string, string> {
  const core = packageDir('tesseract.js-core')
  return {
    'worker.min.js': join(packageDir('tesseract.js'), 'dist/worker.min.js'),
    'tesseract-core-relaxedsimd-lstm.wasm.js': join(core, 'tesseract-core-relaxedsimd-lstm.wasm.js'),
    'tesseract-core-simd-lstm.wasm.js': join(core, 'tesseract-core-simd-lstm.wasm.js'),
    'tesseract-core-lstm.wasm.js': join(core, 'tesseract-core-lstm.wasm.js'),
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

/** The Vite plugin: each of files (served name → installed path) at <base>readers/<name>. */
export function serveReaderFiles(files: Record<string, string>, name = 'ppe-reader-files') {
  return {
    name,
    configureServer(server: DevServer) {
      const prefix = `${server.config.base}readers/`
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]
        const file = path?.startsWith(prefix) ? files[path.slice(prefix.length)] : undefined
        if (!file) return next()
        res.setHeader('Content-Type', types[file.split('.').pop()!] ?? 'application/octet-stream')
        res.end(readFileSync(file))
      })
    },
    generateBundle(this: EmitContext) {
      for (const [fileName, path] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `readers/${fileName}`, source: readFileSync(path) })
      }
    },
  }
}
