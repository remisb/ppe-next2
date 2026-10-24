import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from 'react'

import { moveTo, sameOrder } from './list-order'

interface Drag {
  id: string
  /** The pointer that picked the row up; other pointers are ignored. */
  pointerId: number
  order: string[]
}

/**
 * Moving list rows by a handle. Pressing on a row's handle picks the row up;
 * as the pointer moves the rows reorder under it, so the list always shows
 * where it will land, and nothing is sent; letting go drops it there, calling
 * onDrop once, and only when the order changed. Escape or a cancelled pointer
 * puts it back. The up and down arrow keys on a focused handle move its row
 * one place at once. Rows carry data-row-id, so their places on screen can be
 * read. Pointer events, not the browser's drag and drop, so a finger on a
 * touch screen moves rows too; followed on the window, not captured by the
 * handle, since reordering the rows moves the handle in the page and a moved
 * element loses its pointer capture.
 */
export function useRowDrag(ids: readonly string[], onDrop: (order: string[], moved: string) => void) {
  const [drag, setDrag] = useState<Drag | null>(null)
  // The rows on screen, found once when a row is picked up: only their places are read as it moves.
  const rows = useRef(new Map<string, Element>())
  const latest = useRef({ drag, ids, onDrop })
  latest.current = { drag, ids, onDrop }
  const active = drag !== null

  useEffect(() => {
    if (!active) return
    const move = (e: globalThis.PointerEvent) => {
      const d = latest.current.drag
      if (!d || e.pointerId !== d.pointerId) return
      // The row lands below every other row whose middle is above the pointer.
      let at = 0
      for (const other of d.order) {
        const box = other === d.id ? undefined : rows.current.get(other)?.getBoundingClientRect()
        if (box && e.clientY > box.top + box.height / 2) at++
      }
      const order = moveTo(d.order, d.order.indexOf(d.id), at)
      if (!sameOrder(order, d.order)) setDrag({ ...d, order })
      // Near the window's top or bottom edge the page scrolls, so a long list can be crossed.
      if (e.clientY < 48) window.scrollBy(0, -12)
      else if (e.clientY > window.innerHeight - 48) window.scrollBy(0, 12)
    }
    const up = (e: globalThis.PointerEvent) => {
      const { drag: d, ids: start, onDrop: drop } = latest.current
      if (!d || e.pointerId !== d.pointerId) return
      setDrag(null)
      if (!sameOrder(d.order, start)) drop(d.order, d.id)
    }
    const cancel = () => setDrag(null)
    // Escape while dragging puts the row back, before anything else hears it (closing a pane).
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
    // The page must not select text, and shows the grabbing hand, meanwhile.
    document.body.classList.add('select-none', 'cursor-grabbing')
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      document.body.classList.remove('select-none', 'cursor-grabbing')
    }
  }, [active])

  const handleProps = (id: string) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || latest.current.drag) return
      e.preventDefault()
      rows.current = new Map([...document.querySelectorAll('[data-row-id]')].map((row) => [row.getAttribute('data-row-id')!, row]))
      setDrag({ id, pointerId: e.pointerId, order: [...ids] })
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      e.preventDefault()
      const from = ids.indexOf(id)
      const to = from + (e.key === 'ArrowUp' ? -1 : 1)
      if (from < 0 || to < 0 || to >= ids.length) return
      onDrop(moveTo(ids, from, to), id)
    },
  })

  return { order: drag?.order ?? null, dragging: drag?.id ?? null, handleProps }
}
