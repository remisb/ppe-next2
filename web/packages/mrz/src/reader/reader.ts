/**
 * Reading a photo's MRZ on the page (docs-import plan §5.2, FR-4): the image
 * worker finds and cuts out the band (the pixels transferred; on this thread
 * only if a worker cannot start), the text reader (@ppe/scan-kit's, with the
 * OCR-B model `mrz`) reads it, and the parser checks it. A photo is read
 * twice, the band thresholded two ways, and the reading is agreed only when
 * both give the same lines: check digits alone cannot see every misread
 * (phase 1). Nothing read is ever put into an Error.
 */
import { canvasOf } from '@ppe/scan-kit'
import { createTextReader, PSM, type TextReader } from '@ppe/scan-kit/text-reader'

import { findMrz, rgbaOf, type Rgba } from '../image.ts'
import { readMrz } from '../lines.ts'
import type { Mrz } from '../mrz.ts'
import type { ImageRequest, ImageResponse } from './image-protocol.ts'

/** Every character an MRZ holds. */
export const MRZ_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'

/** The second read's Sauvola k: a lighter threshold than the first's. */
const SECOND_K = 0.4

/** Dictionaries off: an MRZ has no words (phase 1). */
const noDictionaries = {
  load_system_dawg: '0',
  load_freq_dawg: '0',
  load_unambig_dawg: '0',
  load_punc_dawg: '0',
  load_number_dawg: '0',
  load_bigram_dawg: '0',
}

/**
 * Where the MRZ band was found, as fractions of the picture's width and
 * height: its centre and size, and its turn in degrees. The portrait is found
 * from it (docs-import plan FR-11).
 */
export interface BandPlace {
  centre: { x: number; y: number }
  size: { width: number; height: number }
  angle: number
  format: 'TD1' | 'TD2' | 'TD3'
  /** The picture's width over its height, to turn the fractions back into a shape. */
  aspect: number
}

/** What a photo gave. */
export interface PhotoReading {
  /** An MRZ band was found: for a card, this is its back. */
  found: boolean
  /** Where the band is, when found. */
  band?: BandPlace
  /** The lines parsed, when the text read had an MRZ's shape. */
  mrz?: Mrz
  /** Both reads gave the same valid lines (FR-4): the reading may be taken without a second look. */
  agreed: boolean
}

export interface MrzReaderOptions {
  /** Where the readers' files are served: the app's files base and readers/. */
  base: string
}

export interface MrzReader {
  /** Reads a photo; today (ISO) is the organisation's, for the centuries and "expired". */
  readPhoto(photo: Blob, today: string): Promise<PhotoReading>
  /**
   * Reads a live frame (the guide frame's part of the picture) once: its MRZ
   * when every check digit passes, else undefined. The caller takes it once
   * two frames in a row give the same lines (@ppe/scan-kit's Steady, FR-4).
   */
  readFrame(frame: HTMLCanvasElement, today: string): Promise<Mrz | undefined>
  /** Starts loading the reader now, so the first photo reads sooner. */
  warmUp(): void
  stop(): Promise<void>
}

export function createMrzReader(o: MrzReaderOptions): MrzReader {
  const text: TextReader = createTextReader({
    lang: 'mrz',
    base: o.base,
    whitelist: MRZ_CHARACTERS,
    psm: PSM.SINGLE_BLOCK,
    initParameters: noDictionaries,
  })
  const images = imageWorker()

  async function readBand(canvas: HTMLCanvasElement, today: string, k?: number) {
    const found = await images.find(rgbaFromCanvas(canvas), k)
    if ('error' in found || !found.found) return { found: false as const }
    const { text: read } = await text.read(canvasFromRgba(found.band))
    const r = readMrz(read, { today })
    const band: BandPlace = {
      centre: { x: found.centre.x / canvas.width, y: found.centre.y / canvas.height },
      size: { width: found.size.width / canvas.width, height: found.size.height / canvas.height },
      angle: found.angle,
      format: found.format,
      aspect: canvas.width / canvas.height,
    }
    return { found: true as const, band, ...(r.mrz ? { mrz: r.mrz } : {}) }
  }

  return {
    async readPhoto(photo, today) {
      const bitmap = await createImageBitmap(photo)
      const canvas = canvasOf(bitmap)
      bitmap.close()
      const first = await readBand(canvas, today)
      if (!first.found) return { found: false, agreed: false }
      const band = first.band
      const second = await readBand(canvas, today, SECOND_K)
      const a = first.mrz?.valid ? first.mrz : undefined
      const b = second.found && second.mrz?.valid ? second.mrz : undefined
      const agreed = !!a && !!b && a.lines.join('\n') === b.lines.join('\n')
      // The valid reading, the first's when both are; else whatever the first gave, for the user to put right.
      const mrz = a ?? b ?? first.mrz ?? (second.found ? second.mrz : undefined)
      return { found: true, agreed, band, ...(mrz ? { mrz } : {}) }
    },
    async readFrame(frame, today) {
      const r = await readBand(frame, today)
      return r.found && r.mrz?.valid ? r.mrz : undefined
    },
    warmUp: () => text.warmUp(),
    stop: async () => {
      images.stop()
      await text.stop()
    },
  }
}

/** The image worker, or this thread when a worker cannot start (NFR-3). */
function imageWorker() {
  let worker: Worker | undefined
  let here = false
  let next = 0
  const pending = new Map<number, (m: ImageResponse) => void>()
  const start = (): Worker | undefined => {
    if (worker || here) return worker
    try {
      worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module', name: 'mrz-image' })
    } catch {
      here = true
      return undefined
    }
    worker.onmessage = (e: MessageEvent<ImageResponse>) => {
      pending.get(e.data.id)?.(e.data)
      pending.delete(e.data.id)
    }
    worker.onerror = (e) => {
      e.preventDefault()
      here = true
      worker?.terminate()
      worker = undefined
      for (const p of pending.values()) p({ id: -1, error: 'stopped' })
      pending.clear()
    }
    return worker
  }
  return {
    find(image: Rgba, k?: number): Promise<ImageResponse> {
      const w = start()
      if (!w) {
        const f = findMrz(image, k === undefined ? {} : { k })
        return Promise.resolve(
          f
            ? { id: 0, found: true, band: rgbaOf(f.image), angle: f.angle, centre: f.centre, size: f.size, format: f.format, times: {} }
            : { id: 0, found: false, times: {} },
        )
      }
      const id = ++next
      return new Promise((resolve) => {
        pending.set(id, resolve)
        w.postMessage({ type: 'find', id, image, ...(k === undefined ? {} : { k }) } satisfies ImageRequest, [image.data.buffer])
      })
    },
    stop() {
      worker?.terminate()
      worker = undefined
    },
  }
}

function rgbaFromCanvas(c: HTMLCanvasElement): Rgba {
  return c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height)
}

function canvasFromRgba(img: Rgba): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  return c
}
