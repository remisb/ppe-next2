/**
 * The MRZ reader's files, served from the app's origin at <base>readers/
 * (@ppe/scan-kit's reader-files plugin): the text reader's worker and cores,
 * and the OCR-B model `mrz` (DoubangoTelecom's tesseractMRZ, tessdata_fast,
 * BSD-3-Clause: readers/LICENSE.tesseractMRZ; phase 1 chose it), committed
 * gzipped in this package. An app's vite.config.ts imports this file by path.
 */
import { fileURLToPath } from 'node:url'

import { serveReaderFiles as serve, textReaderFiles } from '../../../scan-kit/src/reader-files.ts'

/** Each file as served, and where it is. */
export function mrzReaderFiles(): Record<string, string> {
  return {
    ...textReaderFiles(),
    'mrz.traineddata.gz': fileURLToPath(new URL('../../readers/mrz.traineddata.gz', import.meta.url)),
    'LICENSE.tesseractMRZ': fileURLToPath(new URL('../../readers/LICENSE.tesseractMRZ', import.meta.url)),
  }
}

/** The Vite plugin: the files at <base>readers/<name>. */
export function serveMrzReaderFiles() {
  return serve(mrzReaderFiles(), 'ppe-mrz-reader-files')
}
