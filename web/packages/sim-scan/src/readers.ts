/**
 * Reading carriers in the browser: the SIM No. barcode with zxing-wasm, the
 * PIN and PUK with tesseract.js, each in a worker of its own so the screen
 * and the camera's picture never wait on them. Nothing leaves the browser;
 * both readers' files come from the app's own origin (reader-files.ts), and
 * each loads only when first needed. Never put what was read into an Error:
 * browser errors reach System's error list, and a PIN or PUK must not.
 */
import { createWorker, OEM, PSM, type Worker as TextWorker } from 'tesseract.js'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'

import { BARCODE_FORMATS, type BarcodeRequest, type BarcodeResponse } from './barcode-protocol.ts'
import { codesFromWords, pickSimNo, type Codes, type OcrWord, type PictureRead } from './sim-scan.ts'

let base = '/readers/'

/** Where the readers' files are served: the app's base and readers/ (reader-files.ts). */
export function configureReaders(url: string): void {
  base = url.endsWith('/') ? url : `${url}/`
  // For reading on this thread, should the barcode worker not start (barcodesIn).
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? base + path : prefix + path) } })
}

interface BarcodeWorker {
  worker: Worker
  pending: Map<number, { resolve: (texts: string[]) => void; reject: (e: Error) => void }>
}

let barcodes: BarcodeWorker | undefined
let nextRead = 0
/** Set once the worker could not start or failed: barcodes are read on this thread from then on. */
let barcodesHere = false

/** The barcode worker (barcode.worker.ts), started on first use; undefined when there is none to be had. */
function barcodeWorker(): BarcodeWorker | undefined {
  if (barcodes || barcodesHere) return barcodes
  let worker: Worker
  try {
    worker = new Worker(new URL('./barcode.worker.ts', import.meta.url), { type: 'module', name: 'barcodes' })
  } catch {
    barcodesHere = true
    return undefined
  }
  const pending: BarcodeWorker['pending'] = new Map()
  worker.onmessage = (e: MessageEvent<BarcodeResponse>) => {
    const m = e.data
    const p = pending.get(m.id)
    pending.delete(m.id)
    if ('error' in m) p?.reject(new Error(`The barcode reader failed (${m.error})`))
    else p?.resolve(m.texts)
  }
  // A worker that fails to load or dies: what it was reading is lost (its pixels were handed over), the
  // next reads are done on this thread.
  worker.onerror = (e) => {
    e.preventDefault()
    barcodesHere = true
    barcodes = undefined
    worker.terminate()
    for (const p of pending.values()) p.reject(new Error('The barcode reader stopped'))
    pending.clear()
  }
  worker.postMessage({ type: 'configure', base } satisfies BarcodeRequest)
  barcodes = { worker, pending }
  return barcodes
}

/**
 * The texts of the barcodes in image: the SIM No.'s, as Code 128, ITF or
 * Code 39. Read in the barcode worker, image's pixels handed over to it (the
 * image is empty afterwards); on this thread only if there is no worker.
 */
export async function barcodesIn(image: ImageData): Promise<string[]> {
  const w = barcodeWorker()
  if (!w) {
    const found = await readBarcodes(image, { formats: [...BARCODE_FORMATS], tryHarder: true, maxNumberOfSymbols: 4 })
    return found.filter((r) => r.isValid).map((r) => r.text)
  }
  const id = ++nextRead
  return new Promise((resolve, reject) => {
    w.pending.set(id, { resolve, reject })
    w.worker.postMessage({ type: 'read', id, image } satisfies BarcodeRequest, [image.data.buffer])
  })
}

let ocr: Promise<TextWorker> | undefined

/**
 * The text reader, started on first use: about 5 MB the first time, from the
 * app's origin (the browser keeps the language data afterwards). Digits and
 * the letters of PIN and PUK only; words are read where they lie (sparse text).
 */
function reader(): Promise<TextWorker> {
  ocr ??= (async () => {
    const w = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base.replace(/\/$/, ''),
      gzip: true,
      workerBlobURL: false,
    })
    await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, tessedit_char_whitelist: 'PINUK0123456789 ' })
    return w
  })()
  ocr.catch(() => {
    ocr = undefined
  })
  return ocr
}

/** Starts loading the text reader now, so the first back reads at once. */
export function warmUpReaders(): void {
  void reader().catch(() => undefined)
}

/** The PIN and PUK read from image, a carrier's back. */
export async function codesIn(image: HTMLCanvasElement): Promise<Codes> {
  const w = await reader()
  const { data } = await w.recognize(image, {}, { blocks: true, text: false })
  const words: OcrWord[] = (data.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.map((x) => ({ text: x.text, ...x.bbox })))),
  )
  return codesFromWords(words)
}

/** Stops both readers' workers, freeing their memory; the next read starts them again. */
export async function stopReaders(): Promise<void> {
  const b = barcodes
  barcodes = undefined
  if (b) {
    b.worker.terminate()
    for (const p of b.pending.values()) p.reject(new Error('The barcode reader was stopped'))
  }
  const w = ocr
  ocr = undefined
  if (w) await (await w).terminate()
}

/** The longest side a picture is read at: enough for the barcode's bars and the codes' digits. */
const MAX_SIDE = 2000

/**
 * The longest side a live camera frame's barcode is read at: a card held in
 * the guide frame fills it, so its bars stay several pixels wide, and a
 * smaller frame is read sooner, so the next one comes sooner.
 */
export const LIVE_BARCODE_SIDE = 1280

/** A canvas holding the image, scaled down to maxSide (MAX_SIDE unless said). */
export function canvasOf(
  source: CanvasImageSource & { width: number; height: number },
  crop?: { x: number; y: number; w: number; h: number },
  maxSide = MAX_SIDE,
): HTMLCanvasElement {
  const c = crop ?? { x: 0, y: 0, w: source.width, h: source.height }
  const scale = Math.min(1, maxSide / Math.max(c.w, c.h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(c.w * scale)
  canvas.height = Math.round(c.h * scale)
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function imageDataOf(canvas: HTMLCanvasElement): ImageData {
  return canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
}

/**
 * What one photo shows: its SIM No. when the barcode is on it, else the PIN
 * and PUK. A photo the browser cannot open (HEIC outside Safari) reads as
 * nothing, and the review list asks for its number.
 */
export async function readPhoto(id: string, file: Blob): Promise<PictureRead> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { id, simNo: null, codes: {} }
  }
  try {
    const canvas = canvasOf(bitmap)
    const simNo = pickSimNo(await barcodesIn(imageDataOf(canvas)))
    if (simNo) return { id, simNo, codes: {} }
    return { id, simNo: null, codes: await codesIn(canvas) }
  } finally {
    bitmap.close()
  }
}
