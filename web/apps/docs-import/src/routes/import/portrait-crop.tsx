import { Button } from '@ppe/ui/components/button'
import { Minus, Plus } from 'lucide-react'
import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

import { t } from '@/i18n'
import type { Box } from '@/lib/flow'
import { moveBox, resizeBox } from '@/lib/portrait'

/**
 * The portrait's crop box over the document's picture (FR-11): dragged to
 * move it, its corner dragged to resize it, 3:4 kept; with the keyboard, the
 * arrows move it (Shift: further) and + and − resize it; Larger and Smaller
 * do the same by touch. The box stays inside the picture (lib/portrait.ts).
 */
export function PortraitCrop({
  src,
  aspect,
  box,
  onBox,
}: {
  src: string
  /** The picture's width over its height. */
  aspect: number
  box: Box
  onBox: (box: Box) => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ mode: 'move' | 'resize'; x: number; y: number; start: Box } | null>(null)

  const begin = (mode: 'move' | 'resize') => (e: PointerEvent<HTMLElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, start: box }
  }
  const follow = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current
    const rect = frame.current?.getBoundingClientRect()
    if (!d || !rect) return
    const dx = (e.clientX - d.x) / rect.width
    const dy = (e.clientY - d.y) / rect.height
    onBox(d.mode === 'move' ? moveBox(d.start, dx, dy, aspect) : resizeBox(d.start, d.start.w + 2 * dx, aspect))
  }
  const end = () => {
    drag.current = null
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const move = moves[e.key]
    if (move) {
      e.preventDefault()
      onBox(moveBox(box, move[0], move[1], aspect))
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      onBox(resizeBox(box, box.w + step, aspect))
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      onBox(resizeBox(box, box.w - step, aspect))
    }
  }
  const pct = (n: number) => `${n * 100}%`

  return (
    <div className="flex flex-col gap-2">
      <div ref={frame} className="relative w-full max-w-xl touch-none select-none overflow-hidden rounded-md border border-border">
        <img src={src} alt={t.portrait.documentAlt} className="block w-full" draggable={false} />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/40" style={{ clipPath: holePath(box) }} />
        <div
          role="group"
          aria-label={t.portrait.cropLabel}
          aria-describedby="portrait-crop-hint"
          tabIndex={0}
          onKeyDown={key}
          onPointerDown={begin('move')}
          onPointerMove={follow}
          onPointerUp={end}
          onPointerCancel={end}
          className="absolute cursor-move rounded-sm border-2 border-white outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring"
          style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
        >
          <span
            aria-hidden
            onPointerDown={begin('resize')}
            onPointerMove={follow}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute -right-2.5 -bottom-2.5 size-5 cursor-nwse-resize rounded-full border-2 border-white bg-primary pointer-coarse:size-8 pointer-coarse:-right-4 pointer-coarse:-bottom-4"
          />
        </div>
      </div>
      <p id="portrait-crop-hint" className="text-sm text-muted-foreground">
        {t.portrait.cropHint}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onBox(resizeBox(box, box.w - 0.03, aspect))}>
          <Minus aria-hidden className="size-4" />
          {t.portrait.smaller}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onBox(resizeBox(box, box.w + 0.03, aspect))}>
          <Plus aria-hidden className="size-4" />
          {t.portrait.larger}
        </Button>
      </div>
    </div>
  )
}

/** A clip path for the dimmed picture that leaves the box clear (evenodd: the frame, then the box). */
function holePath(b: Box): string {
  const p = (n: number) => `${n * 100}%`
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${p(b.x)} ${p(b.y)}, ${p(b.x + b.w)} ${p(b.y)}, ${p(b.x + b.w)} ${p(b.y + b.h)}, ${p(b.x)} ${p(b.y + b.h)}, ${p(b.x)} ${p(b.y)})`
}
