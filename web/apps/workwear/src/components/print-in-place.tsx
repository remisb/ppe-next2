import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Prints a document from the page it is on, with no tab of its own: the
 * document is drawn into a container only print shows (index.css hides the
 * rest of the page, open sheets included, while it prints), the browser's
 * print dialog opens over the screen, and the container goes when printing
 * ends. Render `printing` anywhere in the component.
 */
export function usePrintInPlace(): { print: (doc: ReactNode) => void; printing: ReactNode } {
  const [doc, setDoc] = useState<ReactNode>(null)
  useEffect(() => {
    if (doc === null) return
    const root = document.documentElement
    root.dataset['printing'] = ''
    const done = () => {
      delete root.dataset['printing']
      setDoc(null)
    }
    window.addEventListener('afterprint', done, { once: true })
    // Once the container is in the page.
    const frame = requestAnimationFrame(() => window.print())
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('afterprint', done)
      delete root.dataset['printing']
    }
  }, [doc])
  return {
    print: (next: ReactNode) => setDoc(next),
    printing: doc === null ? null : createPortal(<div id="print-in-place">{doc}</div>, document.body),
  }
}
