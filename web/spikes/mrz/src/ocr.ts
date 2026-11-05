/**
 * The text reader as a factory (plan §5.2: Scan SIMs' reader is fixed to
 * English and its own whitelist): one tesseract.js worker per model, started
 * on first use, its files from this origin. No cache, so every run measures
 * the first use's download (Scan SIMs keeps the data in IndexedDB).
 */
import { createWorker, OEM, PSM, type Worker as TextWorker } from 'tesseract.js'

export interface TextReaderOptions {
  lang: string
  /** Where <lang>.traineddata.gz, worker.min.js and the cores are. */
  base: string
  whitelist: string
  psm: PSM
}

export interface TextReader {
  read(image: HTMLCanvasElement): Promise<{ text: string; confidence: number }>
  stop(): Promise<void>
}

export async function createTextReader(o: TextReaderOptions): Promise<TextReader> {
  const w: TextWorker = await createWorker(o.lang, OEM.LSTM_ONLY, {
    workerPath: `${o.base}worker.min.js`,
    corePath: o.base,
    langPath: o.base.replace(/\/$/, ''),
    gzip: true,
    workerBlobURL: false,
    cacheMethod: 'none',
  }, {
    // No dictionaries (set when the model loads): an MRZ has no words.
    load_system_dawg: '0',
    load_freq_dawg: '0',
    load_unambig_dawg: '0',
    load_punc_dawg: '0',
    load_number_dawg: '0',
    load_bigram_dawg: '0',
  })
  await w.setParameters({ tessedit_pageseg_mode: o.psm, tessedit_char_whitelist: o.whitelist })
  return {
    async read(image) {
      const { data } = await w.recognize(image)
      return { text: data.text, confidence: data.confidence }
    },
    stop: () => w.terminate().then(() => undefined),
  }
}

export { PSM }
