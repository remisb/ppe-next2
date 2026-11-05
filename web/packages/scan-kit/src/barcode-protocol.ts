/** What barcodes.ts and barcode.worker.ts say to each other. */
import type { ReadInputBarcodeFormat } from 'zxing-wasm/reader'

/** The barcode formats a reader looks for, by zxing's names (Code128, ITF, PDF417, QRCode…). */
export type BarcodeFormat = ReadInputBarcodeFormat

export type BarcodeRequest =
  /** Where the reader's WebAssembly is served (<base>zxing_reader.wasm), and what to look for. */
  | { type: 'configure'; base: string; formats: BarcodeFormat[]; maxSymbols: number }
  /** An image to read; its pixels are transferred, not copied. */
  | { type: 'read'; id: number; image: ImageData }

export type BarcodeResponse = { id: number; texts: string[] } | { id: number; error: string }
