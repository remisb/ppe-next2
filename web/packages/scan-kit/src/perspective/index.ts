/**
 * A page's perspective, for docs-import's Scan Document: find a document's 4
 * corners in a photo and flatten what is inside them to a rectangle (our own
 * code, no library: edges, Hough lines, a 4-point homography, bilinear
 * sampling). The work runs in a worker, or on this thread when a worker
 * cannot start; the pixels sent are transferred, so send a copy you no
 * longer need.
 */
import type { Quad, Rgba } from './geometry.ts'
import { findPage, type FindPageOptions, type PageFound } from './page.ts'
import type { PerspectiveRequest, PerspectiveResponse } from './protocol.ts'
import { warpPage } from './warp.ts'

export { CONFIDENT, findPage, type FindPageOptions, type PageFound } from './page.ts'
export { pageSize, warpPage, type PageSizeOptions } from './warp.ts'
export { homography, invert, mapPoint, type Mat3 } from './homography.ts'
export {
  areaOf,
  cornerAngles,
  isConvex,
  orderCorners,
  rectQuad,
  scaleQuad,
  sidesOf,
  type Point,
  type Quad,
  type Rgba,
} from './geometry.ts'

export interface Perspective {
  /** The page's corners in image's pixels. */
  find(image: Rgba, o?: FindPageOptions): Promise<PageFound>
  /** The page inside corners flattened to width × height. */
  warp(image: Rgba, corners: Quad, size: { width: number; height: number }): Promise<Rgba>
  stop(): void
}

export function createPerspective(): Perspective {
  let worker: Worker | undefined
  let here = false
  let next = 0
  const pending = new Map<number, (m: PerspectiveResponse) => void>()

  const start = (): Worker | undefined => {
    if (worker || here) return worker
    try {
      worker = new Worker(new URL('./perspective.worker.ts', import.meta.url), { type: 'module', name: 'perspective' })
    } catch {
      here = true
      return undefined
    }
    worker.onmessage = (e: MessageEvent<PerspectiveResponse>) => {
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

  const ask = (req: PerspectiveRequest): Promise<PerspectiveResponse> =>
    new Promise((resolve) => {
      const w = start()!
      pending.set(req.id, resolve)
      w.postMessage(req, [req.image.data.buffer])
    })

  return {
    async find(image, o = {}) {
      if (!start()) return findPage(image, o)
      const r = await ask({ type: 'find', id: ++next, image, ...(o.prior ? { prior: o.prior } : {}), ...(o.aspect ? { aspect: o.aspect } : {}) })
      if ('error' in r) throw new Error(`perspective: ${r.error}`)
      if (r.type !== 'found') throw new Error('perspective: unexpected answer')
      return { corners: r.corners, confidence: r.confidence }
    },
    async warp(image, corners, size) {
      if (!start()) return warpPage(image, corners, size)
      const r = await ask({ type: 'warp', id: ++next, image, corners, width: size.width, height: size.height })
      if ('error' in r) throw new Error(`perspective: ${r.error}`)
      if (r.type !== 'warped') throw new Error('perspective: unexpected answer')
      return r.image
    },
    stop() {
      worker?.terminate()
      worker = undefined
    },
  }
}
