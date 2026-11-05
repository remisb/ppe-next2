/**
 * Reading carriers in the browser (@ppe/scan-kit's readers): the SIM No.'s
 * barcode with zxing-wasm, the PIN and PUK with tesseract.js, each in a
 * worker of its own so the screen and the camera's picture never wait on
 * them. Nothing leaves the browser; both readers' files come from the app's
 * own origin (reader-files.ts), and each loads only when first needed. Never
 * put what was read into an Error: browser errors reach System's error list,
 * and a PIN or PUK must not.
 */
import { createBarcodeReader, type BarcodeReader } from '@ppe/scan-kit/barcodes'
import { canvasOf, imageDataOf } from '@ppe/scan-kit'
import { createTextReader, PSM, type TextReader } from '@ppe/scan-kit/text-reader'

import { codesFromWords, pickSimNo, type Codes, type PictureRead } from './sim-scan.ts'

export { canvasOf, imageDataOf } from '@ppe/scan-kit'

/** The SIM No.'s barcode, as carriers print it: Code 128, sometimes ITF or Code 39. Never EAN-13, the product code. */
export const BARCODE_FORMATS = ['Code128', 'ITF', 'Code39'] as const

/**
 * The longest side a live camera frame's barcode is read at: a card held in
 * the guide frame fills it, so its bars stay several pixels wide, and a
 * smaller frame is read sooner, so the next one comes sooner.
 */
export const LIVE_BARCODE_SIDE = 1280

let barcodes: BarcodeReader | undefined
let text: TextReader | undefined

/** Where the readers' files are served: the app's base and readers/ (reader-files.ts). Call before reading. */
export function configureReaders(url: string): void {
  barcodes?.stop()
  void text?.stop()
  barcodes = createBarcodeReader({ base: url, formats: [...BARCODE_FORMATS] })
  // English data; digits and the letters of PIN and PUK only; words read where they lie (sparse text).
  text = createTextReader({ lang: 'eng', base: url, whitelist: 'PINUK0123456789 ', psm: PSM.SPARSE_TEXT })
}

function readers(): { barcodes: BarcodeReader; text: TextReader } {
  if (!barcodes || !text) configureReaders('/readers/')
  return { barcodes: barcodes!, text: text! }
}

/** The texts of the barcodes in image (its pixels are handed to the reader: it is empty afterwards). */
export function barcodesIn(image: ImageData): Promise<string[]> {
  return readers().barcodes.read(image)
}

/** Starts loading the text reader now, so the first back reads at once. */
export function warmUpReaders(): void {
  readers().text.warmUp()
}

/** The PIN and PUK read from image, a carrier's back. */
export async function codesIn(image: HTMLCanvasElement): Promise<Codes> {
  const { words } = await readers().text.read(image)
  return codesFromWords(words)
}

/** Stops both readers' workers, freeing their memory; the next read starts them again. */
export async function stopReaders(): Promise<void> {
  barcodes?.stop()
  await text?.stop()
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
