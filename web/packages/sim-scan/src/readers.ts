/**
 * Reading carriers in the browser: the SIM No. barcode with zxing-wasm, the
 * PIN and PUK with tesseract.js. Nothing leaves the browser; both readers'
 * files come from the app's own origin (reader-files.ts), and each loads only
 * when first needed. Never put what was read into an Error: browser errors
 * reach System's error list, and a PIN or PUK must not.
 */
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'

import { codesFromWords, pickSimNo, type Codes, type OcrWord, type PictureRead } from './sim-scan.ts'

let base = '/readers/'

/** Where the readers' files are served: the app's base and readers/ (reader-files.ts). */
export function configureReaders(url: string): void {
  base = url.endsWith('/') ? url : `${url}/`
  prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? base + path : prefix + path) } })
}

/** The texts of the barcodes in image: the SIM No.'s, as Code 128, ITF or Code 39. */
export async function barcodesIn(image: ImageData): Promise<string[]> {
  const found = await readBarcodes(image, { formats: ['Code128', 'ITF', 'Code39'], tryHarder: true, maxNumberOfSymbols: 4 })
  return found.filter((r) => r.isValid).map((r) => r.text)
}

let ocr: Promise<Worker> | undefined

/**
 * The text reader, started on first use: about 5 MB the first time, from the
 * app's origin (the browser keeps the language data afterwards). Digits and
 * the letters of PIN and PUK only; words are read where they lie (sparse text).
 */
function reader(): Promise<Worker> {
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

/** Stops the text reader, freeing its memory. */
export async function stopReaders(): Promise<void> {
  const w = ocr
  ocr = undefined
  if (w) await (await w).terminate()
}

/** The longest side a picture is read at: enough for the barcode's bars and the codes' digits. */
const MAX_SIDE = 2000

/** A canvas holding the image, scaled down to MAX_SIDE. */
export function canvasOf(source: CanvasImageSource & { width: number; height: number }, crop?: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const c = crop ?? { x: 0, y: 0, w: source.width, h: source.height }
  const scale = Math.min(1, MAX_SIDE / Math.max(c.w, c.h))
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
