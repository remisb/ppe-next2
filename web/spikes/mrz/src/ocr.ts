/**
 * The text reader for the spike: @ppe/scan-kit's createTextReader (the
 * factory the plan's section 6 asks for, which Scan SIMs uses too), with an
 * MRZ's settings: no dictionaries (an MRZ has no words) and no cache, so every
 * run measures the first use's download. Started at once, so a reading's time
 * never includes the start.
 */
import { createTextReader as textReader, PSM, type TextReader } from '@ppe/scan-kit/text-reader'

export { PSM }
export type { TextReader }

export interface TextReaderOptions {
  lang: string
  /** Where <lang>.traineddata.gz, worker.min.js and the cores are. */
  base: string
  whitelist: string
  psm: PSM
}

const noDictionaries = {
  load_system_dawg: '0',
  load_freq_dawg: '0',
  load_unambig_dawg: '0',
  load_punc_dawg: '0',
  load_number_dawg: '0',
  load_bigram_dawg: '0',
}

export async function createTextReader(o: TextReaderOptions): Promise<TextReader> {
  const reader = textReader({ ...o, initParameters: noDictionaries, cache: false })
  await reader.ready()
  return reader
}
