/**
 * Reads a document's printed fields in the browser (docs-scan plan DS-14): its pages with
 * tesseract.js and the Lithuanian model (`lit`, tessdata_best int, Apache-2.0; the app serves it
 * at <files>readers/lit.traineddata.gz), in Tesseract's own worker, loaded on first use and
 * stopped after, then printed.ts' rules. Nothing read is ever put into an Error.
 */
import type { Mrz } from '@ppe/mrz'
import { filesBase } from '@ppe/routing'

import { readPrinted, type PrintedFields } from './printed.ts'

/** The model's language, as the app serves its file. */
export const PRINTED_LANG = 'lit'

/** The fields the pages print, and which page holds the names (for the picture of their line). */
export interface PrintedReading {
  fields: PrintedFields
  namesPage?: number
}

export async function readPrintedPages(pages: readonly Blob[], m: Mrz): Promise<PrintedReading> {
  const { createTextReader } = await import('@ppe/scan-kit/text-reader')
  const reader = createTextReader({ lang: PRINTED_LANG, base: `${filesBase}readers/` })
  const facts = { surname: m.surname, givenNames: m.givenNames, birthDate: m.birthDate, expiryDate: m.expiryDate, namesFull: !m.nameField.endsWith('<') }
  const out: PrintedReading = { fields: {} }
  try {
    for (const [i, blob] of pages.entries()) {
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
      bitmap.close()
      const got = readPrinted((await reader.read(canvas)).lines, facts)
      if (!out.fields.surname && got.surname) {
        out.fields.surname = got.surname
        out.namesPage = i
        if (got.givenNames) out.fields.givenNames = got.givenNames
      }
      if (!out.fields.issuedOn && got.issuedOn) out.fields.issuedOn = got.issuedOn
    }
  } finally {
    await reader.stop()
  }
  return out
}
