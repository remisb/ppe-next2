/** What readers.ts and barcode.worker.ts say to each other. */

/** The SIM No.'s barcode, as carriers print it: Code 128, sometimes ITF or Code 39. Never EAN-13, the product code. */
export const BARCODE_FORMATS = ['Code128', 'ITF', 'Code39'] as const

export type BarcodeRequest =
  /** Where the reader's WebAssembly is served (<base>zxing_reader.wasm). */
  | { type: 'configure'; base: string }
  /** An image to read; its pixels are transferred, not copied. */
  | { type: 'read'; id: number; image: ImageData }

export type BarcodeResponse = { id: number; texts: string[] } | { id: number; error: string }
