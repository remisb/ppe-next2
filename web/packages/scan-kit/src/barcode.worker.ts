/**
 * The barcode reader in a worker of its own, so a camera frame's decoding
 * (tens to hundreds of milliseconds with tryHarder) never holds up the
 * screen and the camera's picture (docs/apps/sim-scan-review.md F2). It
 * answers barcodes.ts: first where the reader's WebAssembly is (the app's
 * own files, reader-files.ts) and what to look for, then one image at a time.
 * Nothing read is ever put in an error: errors are sent back by name only.
 */
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'

import type { BarcodeFormat, BarcodeRequest, BarcodeResponse } from './barcode-protocol.ts'

const post = (m: BarcodeResponse) => (self as unknown as Worker).postMessage(m)
let formats: BarcodeFormat[] = []
let maxSymbols = 1

self.onmessage = async (e: MessageEvent<BarcodeRequest>) => {
  const m = e.data
  if (m.type === 'configure') {
    const base = m.base
    formats = m.formats
    maxSymbols = m.maxSymbols
    prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? base + path : prefix + path) } })
    return
  }
  try {
    const found = await readBarcodes(m.image, { formats, tryHarder: true, maxNumberOfSymbols: maxSymbols })
    post({ id: m.id, texts: found.filter((r) => r.isValid).map((r) => r.text) })
  } catch (err) {
    post({ id: m.id, error: err instanceof Error ? err.name : 'Error' })
  }
}
