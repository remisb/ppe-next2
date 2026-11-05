/**
 * A barcode reader (zxing-wasm) in a worker of its own (barcode.worker.ts),
 * started on first use, each image's pixels transferred to it, so the screen
 * and the camera's picture never wait on a decode (docs/apps/sim-scan-review.md
 * F2). If the worker cannot start or fails, it reads on the page's thread.
 * Its WebAssembly comes from the app's own files (reader-files.ts). Never put
 * what was read into an Error: browser errors reach System's error list.
 */
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'

import type { BarcodeFormat, BarcodeRequest, BarcodeResponse } from './barcode-protocol.ts'

export type { BarcodeFormat } from './barcode-protocol.ts'

export interface BarcodeReaderOptions {
  /** Where zxing_reader.wasm is served: the app's base and readers/. */
  base: string
  /** What to look for, by zxing's names. */
  formats: BarcodeFormat[]
  /** The most barcodes one image is searched for (default 4). */
  maxSymbols?: number
}

export interface BarcodeReader {
  /** The valid barcodes' texts in image. The image's pixels are handed over: it is empty afterwards. */
  read(image: ImageData): Promise<string[]>
  /** Stops the worker, freeing its memory; the next read starts it again. */
  stop(): void
}

export function createBarcodeReader(options: BarcodeReaderOptions): BarcodeReader {
  const base = options.base.endsWith('/') ? options.base : `${options.base}/`
  const formats = [...options.formats]
  const maxSymbols = options.maxSymbols ?? 4
  let worker: Worker | undefined
  let here = false // set once the worker could not start or failed
  let preparedHere = false
  let nextRead = 0
  const pending = new Map<number, { resolve: (texts: string[]) => void; reject: (e: Error) => void }>()

  const failAll = (message: string) => {
    for (const p of pending.values()) p.reject(new Error(message))
    pending.clear()
  }

  const start = (): Worker | undefined => {
    if (worker || here) return worker
    try {
      worker = new Worker(new URL('./barcode.worker.ts', import.meta.url), { type: 'module', name: 'barcodes' })
    } catch {
      here = true
      return undefined
    }
    const w = worker
    w.onmessage = (e: MessageEvent<BarcodeResponse>) => {
      const m = e.data
      const p = pending.get(m.id)
      pending.delete(m.id)
      if ('error' in m) p?.reject(new Error(`The barcode reader failed (${m.error})`))
      else p?.resolve(m.texts)
    }
    // A worker that fails to load or dies: what it was reading is lost (its pixels were handed over),
    // the next reads are done on this thread.
    w.onerror = (e) => {
      e.preventDefault()
      here = true
      worker = undefined
      w.terminate()
      failAll('The barcode reader stopped')
    }
    w.postMessage({ type: 'configure', base, formats, maxSymbols } satisfies BarcodeRequest)
    return w
  }

  const readHere = async (image: ImageData) => {
    if (!preparedHere) {
      prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? base + path : prefix + path) } })
      preparedHere = true
    }
    const found = await readBarcodes(image, { formats, tryHarder: true, maxNumberOfSymbols: maxSymbols })
    return found.filter((r) => r.isValid).map((r) => r.text)
  }

  return {
    read(image) {
      const w = start()
      if (!w) return readHere(image)
      const id = ++nextRead
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        w.postMessage({ type: 'read', id, image } satisfies BarcodeRequest, [image.data.buffer])
      })
    },
    stop() {
      worker?.terminate()
      worker = undefined
      failAll('The barcode reader was stopped')
    },
  }
}
