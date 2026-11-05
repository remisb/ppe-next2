/**
 * A photo or a live-sized frame to MRZ, on the page: the image worker finds
 * and cuts out the band (pixels transferred, the work on this thread only if
 * the worker cannot start), the text reader reads it, @ppe/mrz parses it.
 * Every step's time is kept for the measurements.
 */
import { readMrz, type Mrz } from '@ppe/mrz'

import { findMrz, rgbaOf, type Rgba } from './image.ts'
import type { ImageRequest, ImageResponse } from './image-protocol.ts'
import type { TextReader } from './ocr.ts'

let worker: Worker | undefined
let here = false
let next = 0
const pending = new Map<number, (m: ImageResponse) => void>()

function imageWorker(): Worker | undefined {
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

/** The band of image, cut out (image's pixels handed to the worker). */
export async function findBand(image: Rgba, k?: number): Promise<ImageResponse> {
  const w = imageWorker()
  if (!w) {
    const t0 = performance.now()
    const f = findMrz(image, { now: () => performance.now(), ...(k === undefined ? {} : { k }) })
    const times = { ...(f?.times ?? {}), total: performance.now() - t0 }
    return f ? { id: 0, found: true, band: rgbaOf(f.image), angle: f.angle, format: f.format, times } : { id: 0, found: false, times }
  }
  const id = ++next
  return new Promise((resolve) => {
    pending.set(id, resolve)
    w.postMessage({ type: 'find', id, image, ...(k === undefined ? {} : { k }) } satisfies ImageRequest, [image.data.buffer])
  })
}

export const MAX_SIDE = 2000

export function canvasOf(source: CanvasImageSource & { width: number; height: number }, maxSide = MAX_SIDE, crop?: { x: number; y: number; w: number; h: number }): HTMLCanvasElement {
  const c = crop ?? { x: 0, y: 0, w: source.width, h: source.height }
  const s = Math.min(1, maxSide / Math.max(c.w, c.h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(c.w * s)
  canvas.height = Math.round(c.h * s)
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height)
  return canvas
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

export interface Reading {
  found: boolean
  mrz?: Mrz
  fitted?: boolean
  /** The OCR's text, for looking at misreads in the spike; never logged by an app. */
  text?: string
  /** The second read's lines (another threshold), when one was made. */
  second?: { valid: boolean; same: boolean }
  band?: HTMLCanvasElement
  times: Record<string, number>
}

export interface ReadOptions {
  today: string
  /** Read the band a second time, thresholded otherwise, and say whether it agrees. */
  second?: boolean
}

/** Reads the MRZ in a picture already on a canvas (a photo scaled to MAX_SIDE, or a live frame's strip). */
export async function readCanvas(canvas: HTMLCanvasElement, reader: TextReader, o: ReadOptions): Promise<Reading> {
  const times: Record<string, number> = {}
  let t = performance.now()
  const found = await findBand(rgbaFromCanvas(canvas))
  times['image'] = performance.now() - t
  if ('error' in found || !found.found) return { found: false, times }
  for (const [k, v] of Object.entries(found.times)) times[`image.${k}`] = v
  const band = canvasFromRgba(found.band)
  t = performance.now()
  const { text } = await reader.read(band)
  times['ocr'] = performance.now() - t
  t = performance.now()
  const r = readMrz(text, { today: o.today })
  times['parse'] = performance.now() - t
  const reading: Reading = { found: true, text, band, times, ...(r.mrz ? { mrz: r.mrz } : {}), fitted: r.fitted }
  if (o.second && r.mrz?.valid) {
    t = performance.now()
    const again = await findBand(rgbaFromCanvas(canvas), 0.4)
    if (!('error' in again) && again.found) {
      const r2 = readMrz((await reader.read(canvasFromRgba(again.band))).text, { today: o.today })
      reading.second = { valid: !!r2.mrz?.valid, same: !!r2.mrz && r2.mrz.lines.join('\n') === r.mrz.lines.join('\n') }
    } else reading.second = { valid: false, same: false }
    times['second'] = performance.now() - t
  }
  return reading
}

/** Reads a photo (a file or a fetched image). */
export async function readPhoto(file: Blob, reader: TextReader, o: ReadOptions): Promise<Reading> {
  const t0 = performance.now()
  const bitmap = await createImageBitmap(file)
  const canvas = canvasOf(bitmap)
  bitmap.close()
  const decode = performance.now() - t0
  const r = await readCanvas(canvas, reader, o)
  r.times['decode'] = decode
  r.times['total'] = performance.now() - t0
  return r
}
