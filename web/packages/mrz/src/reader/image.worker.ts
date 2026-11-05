/**
 * The image work in a worker of its own (NFR-3, the barcode.worker.ts
 * pattern): grey, threshold, skew, the MRZ band and its cut-out, so the
 * page and the camera's picture never wait on them. Errors go back by name.
 */
import { findMrz, rgbaOf } from '../image.ts'
import type { ImageRequest, ImageResponse } from './image-protocol.ts'

const post = (m: ImageResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

self.onmessage = (e: MessageEvent<ImageRequest>) => {
  const m = e.data
  const t0 = performance.now()
  try {
    const found = findMrz(m.image, { now: () => performance.now(), ...(m.k === undefined ? {} : { k: m.k }) })
    if (!found) return post({ id: m.id, found: false, times: { total: performance.now() - t0 } })
    const band = rgbaOf(found.image)
    post(
      {
        id: m.id,
        found: true,
        band,
        angle: found.angle,
        centre: found.centre,
        size: found.size,
        format: found.format,
        times: { ...found.times, total: performance.now() - t0 },
      },
      [band.data.buffer],
    )
  } catch (err) {
    post({ id: m.id, error: err instanceof Error ? err.name : 'Error' })
  }
}
