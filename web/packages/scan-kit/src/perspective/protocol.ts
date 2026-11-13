/** What index.ts and perspective.worker.ts say to each other (the barcode-protocol.ts pattern). */
import type { Quad, Rgba } from './geometry.ts'

export type PerspectiveRequest =
  | {
      type: 'find'
      id: number
      /** The picture; its pixels are transferred, not copied. */
      image: Rgba
      prior?: Quad
      aspect?: number
    }
  | {
      type: 'warp'
      id: number
      /** The picture; its pixels are transferred, not copied. */
      image: Rgba
      corners: Quad
      width: number
      height: number
    }

export type PerspectiveResponse =
  | { id: number; type: 'found'; corners: Quad; confidence: number }
  /** The flattened page, transferred back. */
  | { id: number; type: 'warped'; image: Rgba }
  /** By name only: nothing in a picture is ever put into an error. */
  | { id: number; error: string }
