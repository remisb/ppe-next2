import type { Turn } from '@ppe/mrz/reader'
import type { Quad } from '@ppe/scan-kit/perspective'
import { Button } from '@ppe/ui/components/button'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { t } from '@/i18n'
import { ARROWS, keyStep, moveCorner } from '@/lib/corners'
import { turnedPreview } from '@/lib/make-page'

/**
 * Adjust Corners (Scan Document): the photo, turned as its page is, with the
 * page's 4 corners as handles and the page's outline between them. A handle
 * is dragged, or focused (Tab) and moved with the arrow keys, Shift for
 * further (lib/corners.ts keeps it inside the photo and the page unfolded).
 * Done makes the page again from these corners.
 */
export function CornerEditor({
  photo,
  turn,
  corners,
  size,
  onDone,
  onCancel,
}: {
  photo: Blob
  turn: Turn
  /** In the turned photo's full pixels. */
  corners: Quad
  /** The turned photo's full size. */
  size: { width: number; height: number }
  onDone: (corners: Quad) => void
  onCancel: () => void
}) {
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null)
  const [quad, setQuad] = useState<Quad>(corners)
  const frame = useRef<HTMLDivElement>(null)
  const dragging = useRef<number | null>(null)

  useEffect(() => {
    let live = true
    let url: string | undefined
    void turnedPreview(photo, turn).then((p) => {
      if (!live) return
      url = URL.createObjectURL(p.blob)
      setPreview({ url, width: p.width, height: p.height })
    })
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [photo, turn])

  const move = (i: number, to: { x: number; y: number }) => setQuad((q) => moveCorner(q, i, to, size.width, size.height))

  const follow = (e: PointerEvent<HTMLElement>) => {
    const i = dragging.current
    const rect = frame.current?.getBoundingClientRect()
    if (i === null || !rect) return
    move(i, { x: ((e.clientX - rect.left) / rect.width) * size.width, y: ((e.clientY - rect.top) / rect.height) * size.height })
  }

  const key = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const d = ARROWS[e.key]
    if (!d) return
    e.preventDefault()
    const step = keyStep(size.width, size.height, e.shiftKey)
    const c = quad[i]!
    move(i, { x: c.x + d.x * step, y: c.y + d.y * step })
  }

  const pct = (v: number, of: number) => `${(v / of) * 100}%`
  const outline = quad.map((p) => `${(p.x / size.width) * 100},${(p.y / size.height) * 100}`).join(' ')

  return (
    <FormSheet
      open
      wide
      onClose={onCancel}
      title={t.scan.cornersTitle}
      description={t.scan.cornersHint}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            {t.scan.cancel}
          </Button>
          <Button onClick={() => onDone(quad)}>{t.scan.cornersDone}</Button>
        </div>
      }
    >
      {preview ? (
        <div className="flex h-full items-center justify-center">
          <div
            ref={frame}
            className="relative touch-none select-none"
            style={{ aspectRatio: `${preview.width} / ${preview.height}`, maxHeight: '100%', maxWidth: '100%', width: preview.width >= preview.height ? '100%' : 'auto', height: preview.width >= preview.height ? 'auto' : '100%' }}
            onPointerMove={follow}
            onPointerUp={() => (dragging.current = null)}
            onPointerCancel={() => (dragging.current = null)}
          >
            <img src={preview.url} alt={t.scan.photoAlt} className="block size-full" draggable={false} />
            <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
              <polygon points={outline} className="fill-primary/15 stroke-primary" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            </svg>
            {quad.map((c, i) => (
              <button
                key={i}
                type="button"
                aria-label={t.scan.cornerNames[i]}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  dragging.current = i
                }}
                onPointerMove={follow}
                onPointerUp={() => (dragging.current = null)}
                onKeyDown={key(i)}
                className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ left: pct(c.x, size.width), top: pct(c.y, size.height) }}
              >
                <span className="size-5 rounded-full border-2 border-white bg-primary shadow" />
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </FormSheet>
  )
}
