/**
 * Finding a page's corners and flattening it, in a worker of its own (the
 * barcode.worker.ts pattern), so the screen never waits on the pixels.
 * Errors go back by name.
 */
import { findPage } from './page.ts'
import type { PerspectiveRequest, PerspectiveResponse } from './protocol.ts'
import { warpPage } from './warp.ts'

const post = (m: PerspectiveResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

self.onmessage = (e: MessageEvent<PerspectiveRequest>) => {
  const m = e.data
  try {
    if (m.type === 'find') {
      const found = findPage(m.image, { ...(m.prior ? { prior: m.prior } : {}), ...(m.aspect ? { aspect: m.aspect } : {}) })
      post({ id: m.id, type: 'found', corners: found.corners, confidence: found.confidence })
    } else {
      const image = warpPage(m.image, m.corners, { width: m.width, height: m.height })
      post({ id: m.id, type: 'warped', image }, [image.data.buffer])
    }
  } catch (err) {
    post({ id: m.id, error: err instanceof Error ? err.name : 'Error' })
  }
}
