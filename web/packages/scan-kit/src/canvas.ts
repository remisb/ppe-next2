/** Pictures as canvases and pixels, at the size a reader needs. */

/** The longest side a picture is read at unless said: enough for a barcode's bars and printed digits. */
export const MAX_SIDE = 2000

/** A canvas holding source (or crop of it), scaled down so its longest side is at most maxSide. */
export function canvasOf(
  source: CanvasImageSource & { width: number; height: number },
  crop?: { x: number; y: number; w: number; h: number },
  maxSide = MAX_SIDE,
): HTMLCanvasElement {
  const c = crop ?? { x: 0, y: 0, w: source.width, h: source.height }
  const scale = Math.min(1, maxSide / Math.max(c.w, c.h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(c.w * scale)
  canvas.height = Math.round(c.h * scale)
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** canvas's pixels: a copy, which a reader may take over. */
export function imageDataOf(canvas: HTMLCanvasElement): ImageData {
  return canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
}
