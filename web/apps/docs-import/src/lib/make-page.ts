/**
 * Scan Document's page, made from a photo in the browser: the way up from
 * its MRZ (the reader tries 90°, 180° and 270°), the page's 4 corners
 * (@ppe/scan-kit's findPage, near where the band puts the page), flattened
 * by a perspective transform, drawn anew as a JPEG (no camera metadata, as
 * Document Copies: PR-3), and read again. The perspective's code is loaded
 * with the reader, on first use.
 */
import type { IdentityDocumentKind } from '@ppe/api-client'
import type { BandPlace, PhotoReading, Turn } from '@ppe/mrz/reader'
import type { Perspective, Quad, Rgba } from '@ppe/scan-kit/perspective'

import { COPY_MAX_SIDE } from './flow'
import { aspectOf, pageQuad } from './page-box'
import { loadReader, todayHere } from './reader'
import { docTypeOf } from './scan'

/** The side corners are looked for at; findPage works smaller still. */
const FIND_SIDE = 1000

/** The largest side the photo is flattened from: more than the page needs, less than a phone's full photo. */
const WARP_SIDE = 3200

type Tools = { perspective: Perspective; pageSize: typeof import('@ppe/scan-kit/perspective').pageSize }

let loading: Promise<Tools> | undefined

function loadPerspective(): Promise<Tools> {
  loading ??= import('@ppe/scan-kit/perspective').then((p) => ({ perspective: p.createPerspective(), pageSize: p.pageSize }))
  loading.catch(() => {
    loading = undefined
  })
  return loading
}


export interface MadePage {
  /** The flattened page, a JPEG. */
  blob: Blob
  turn: Turn
  /** In the turned photo's pixels (its full size). */
  corners: Quad
  size: { width: number; height: number }
  confidence: number
  /** The flattened page's own reading, when it has code lines. */
  reading?: PhotoReading
}

export interface MakeOptions {
  /** The turn the user chose (Turn Left, Turn Right): the way up is not looked for. */
  turn?: Turn
  /** The corners the user set (Adjust Corners): they are not looked for. */
  corners?: Quad
  /** What the document is, for a page without code lines. */
  kind: IdentityDocumentKind
  /** The page's MRZ format when it was read before: the page keeps the document's shape. */
  format?: BandPlace['format']
}

export async function makePage(photo: Blob, o: MakeOptions): Promise<MadePage> {
  const reader = await loadReader()
  const today = todayHere()
  const first = o.turn === undefined && !o.corners ? await reader.readPhoto(photo, today, { turns: true }) : undefined
  const turn: Turn = o.turn ?? first?.turn ?? 0
  const bitmap = await createImageBitmap(photo)
  try {
    const sideways = turn === 90 || turn === 270
    const size = { width: sideways ? bitmap.height : bitmap.width, height: sideways ? bitmap.width : bitmap.height }
    const { perspective, pageSize } = await loadPerspective()

    let corners = o.corners
    let confidence = 1
    if (!corners) {
      const small = turnedCanvas(bitmap, turn, FIND_SIDE)
      const k = small.width / size.width
      const band = first?.found ? first.band : undefined
      const found = await perspective.find(rgbaOf(small), {
        ...(band ? { prior: pageQuad(band, small.width, small.height), aspect: aspectOf(band.format, docTypeOf(o.kind)) } : {}),
      })
      corners = found.corners.map((p) => ({ x: p.x / k, y: p.y / k })) as Quad
      confidence = found.confidence
    }

    const large = turnedCanvas(bitmap, turn, WARP_SIDE)
    const k = large.width / size.width
    const inLarge = corners.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad
    const format = o.format ?? (first?.found ? first.band?.format : undefined)
    const out = pageSize(inLarge, { ...(format ? { aspect: aspectOf(format, docTypeOf(o.kind)) } : {}), maxSide: COPY_MAX_SIDE })
    const flat = await perspective.warp(rgbaOf(large), inLarge, out)
    const blob = await jpegOf(flat)
    // Read again: the page's own band (for the portrait and Import to Personnel), and a check of the flattening.
    const again = await reader.readPhoto(blob, today)
    return { blob, turn, corners, size, confidence, ...(again.found ? { reading: again } : {}) }
  } finally {
    bitmap.close()
  }
}

/** The photo turned clockwise by turn, its longest side at most maxSide. */
export function turnedCanvas(source: ImageBitmap | HTMLImageElement, turn: Turn, maxSide: number): HTMLCanvasElement {
  const w = source.width
  const h = source.height
  const scale = Math.min(1, maxSide / Math.max(w, h))
  const sideways = turn === 90 || turn === 270
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round((sideways ? h : w) * scale))
  c.height = Math.max(1, Math.round((sideways ? w : h) * scale))
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((turn * Math.PI) / 180)
  ctx.scale(scale, scale)
  ctx.drawImage(source, -w / 2, -h / 2)
  return c
}

function rgbaOf(c: HTMLCanvasElement): Rgba {
  return c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height)
}

function jpegOf(img: Rgba): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('the page could not be made'))), 'image/jpeg', 0.9))
}

/** The turned photo as a picture for Adjust Corners, at most maxSide, and the scale from the full turned photo. */
export async function turnedPreview(photo: Blob, turn: Turn, maxSide = 1600): Promise<{ blob: Blob; width: number; height: number; scale: number }> {
  const bitmap = await createImageBitmap(photo)
  try {
    const c = turnedCanvas(bitmap, turn, maxSide)
    const full = turn === 90 || turn === 270 ? bitmap.height : bitmap.width
    const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('no preview'))), 'image/jpeg', 0.85))
    return { blob, width: c.width, height: c.height, scale: c.width / full }
  } finally {
    bitmap.close()
  }
}
