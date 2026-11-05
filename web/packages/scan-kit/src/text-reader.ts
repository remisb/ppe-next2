/**
 * A text reader (tesseract.js) as a factory: one model, one character list,
 * one page layout, in Tesseract's own worker, started on first use, its files
 * from the app's own origin (reader-files.ts). Scan SIMs reads a carrier's
 * back with English and the letters of PIN and PUK; docs-import reads an MRZ
 * with an OCR-B model (docs/apps/docs-import-plan.md, section 5.2). Never put
 * what was read into an Error: browser errors reach System's error list.
 */
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js'

export { PSM }

/** A word the reader found, with its box in the image's pixels. */
export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface TextRead {
  text: string
  /** Tesseract's confidence in the whole page, 0–100. */
  confidence: number
  words: OcrWord[]
}

export interface TextReaderOptions {
  /** The model: <lang>.traineddata.gz at base. */
  lang: string
  /** Where worker.min.js, the cores and the model are served: the app's base and readers/. */
  base: string
  /** The only characters it may read (Tesseract's tessedit_char_whitelist). */
  whitelist?: string
  psm?: PSM
  /** Parameters set as the model loads, such as dictionaries off for codes that are no words. */
  initParameters?: Record<string, string>
  /** Whether the browser keeps the model after the first download (IndexedDB; default true). Off to measure. */
  cache?: boolean
}

export interface TextReader {
  read(image: HTMLCanvasElement): Promise<TextRead>
  /** Starts loading now, so the first read is quicker. */
  warmUp(): void
  /** Starts loading now and resolves once the reader can read (or rejects when it cannot start). */
  ready(): Promise<void>
  /** Stops the worker, freeing its memory; the next read starts it again. */
  stop(): Promise<void>
}

export function createTextReader(o: TextReaderOptions): TextReader {
  const base = o.base.endsWith('/') ? o.base : `${o.base}/`
  let started: Promise<Worker> | undefined
  const start = (): Promise<Worker> => {
    started ??= (async () => {
      const w = await createWorker(
        o.lang,
        OEM.LSTM_ONLY,
        {
          workerPath: `${base}worker.min.js`,
          corePath: base,
          langPath: base.replace(/\/$/, ''),
          gzip: true,
          workerBlobURL: false,
          ...(o.cache === false ? { cacheMethod: 'none' } : {}),
        },
        o.initParameters,
      )
      const params: Record<string, string | PSM> = {}
      if (o.psm !== undefined) params['tessedit_pageseg_mode'] = o.psm
      if (o.whitelist !== undefined) params['tessedit_char_whitelist'] = o.whitelist
      if (Object.keys(params).length > 0) await w.setParameters(params)
      return w
    })()
    started.catch(() => {
      started = undefined
    })
    return started
  }
  return {
    async read(image) {
      const w = await start()
      const { data } = await w.recognize(image, {}, { blocks: true, text: true })
      const words: OcrWord[] = (data.blocks ?? []).flatMap((b) =>
        b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words.map((x) => ({ text: x.text, ...x.bbox })))),
      )
      return { text: data.text, confidence: data.confidence, words }
    },
    warmUp() {
      void start().catch(() => undefined)
    },
    async ready() {
      await start()
    },
    async stop() {
      const w = started
      started = undefined
      if (w) await (await w).terminate()
    },
  }
}
