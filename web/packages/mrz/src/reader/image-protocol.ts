/** What reader.ts and image.worker.ts say to each other (the barcode-protocol.ts pattern of @ppe/scan-kit). */
import type { Rgba } from '../image.ts'

export type ImageRequest = {
  type: 'find'
  id: number
  /** The picture; its pixels are transferred, not copied. */
  image: Rgba
  k?: number
}

export type ImageResponse =
  | {
      id: number
      found: true
      /** The cut-out band, RGBA, transferred back. */
      band: Rgba
      angle: number
      /** Where the band is in the picture sent: its centre and size in its pixels. */
      centre: { x: number; y: number }
      size: { width: number; height: number }
      format: 'TD1' | 'TD2' | 'TD3'
      times: Record<string, number>
    }
  | { id: number; found: false; times: Record<string, number> }
  /** By name only: nothing read is ever put into an error. */
  | { id: number; error: string }
