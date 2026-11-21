import type { Box } from '@ppe/id-docs/printed'
import { useEffect, useState } from 'react'

/** A part of a page, a little wider than box: the names as the document prints them, to compare with. */
export function PrintedLine({ page, boxes, alt }: { page: Blob; boxes: readonly Box[]; alt: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const key = boxes.map((b) => `${b.x0},${b.y0},${b.x1},${b.y1}`).join('|')
  useEffect(() => {
    let live = true
    let made: string | undefined
    void (async () => {
      const bitmap = await createImageBitmap(page)
      const pad = Math.round(bitmap.height * 0.02)
      const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x0)) - pad)
      const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y0)) - pad)
      const x1 = Math.min(bitmap.width, Math.max(...boxes.map((b) => b.x1)) + pad)
      const y1 = Math.min(bitmap.height, Math.max(...boxes.map((b) => b.y1)) + pad)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, x1 - x0)
      canvas.height = Math.max(1, y1 - y0)
      canvas.getContext('2d')!.drawImage(bitmap, x0, y0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
      bitmap.close()
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!live || !blob) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    })()
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [page, key])
  return url ? <img src={url} alt={alt} className="max-h-24 w-full rounded-md bg-white object-contain object-left" /> : null
}
