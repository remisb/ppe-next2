/**
 * Scan SIMs' readers' files, served from the app's origin at <base>readers/:
 * @ppe/scan-kit's barcode and text readers' own files, and the English model
 * the text reader reads a carrier's back with. The Vite plugin for the app's
 * vite.config.ts, which imports this file by path (scan-kit's reader-files.ts
 * says why); so does this one import scan-kit's.
 */
import { join } from 'node:path'

import { barcodeReaderFiles, packageDir, serveReaderFiles as serve, textReaderFiles } from '../../scan-kit/src/reader-files.ts'

/** Each file as served, and where it is installed. */
export function readerFiles(): Record<string, string> {
  return {
    ...barcodeReaderFiles(),
    ...textReaderFiles(),
    'eng.traineddata.gz': join(packageDir('@tesseract.js-data/eng', import.meta.url), '4.0.0_best_int/eng.traineddata.gz'),
  }
}

/** The Vite plugin: the files at <base>readers/<name>. */
export function serveReaderFiles() {
  return serve(readerFiles(), 'ppe-sim-scan-reader-files')
}
