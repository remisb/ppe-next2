import { useEffect, useState } from 'react'

/**
 * Smaller gaps between the window and what is visible are the browser's own
 * bars coming and going as the page scrolls (Safari's toolbar), not a keyboard.
 */
export const KEYBOARD_MIN = 120

/**
 * How far the on-screen keyboard reaches up into the window from its bottom,
 * in CSS pixels; 0 when none is up. The keyboard shrinks the visual viewport
 * and leaves the layout viewport (window.innerHeight) as it was, on an iPhone
 * and on Android alike (Chrome's default, resizes-visual); when the browser
 * has also scrolled the page to show the field, the visual viewport is moved
 * down by offsetTop, which hides less of the window's bottom.
 */
export function keyboardInset(innerHeight: number, viewport: { height: number; offsetTop: number }): number {
  const hidden = innerHeight - viewport.height - viewport.offsetTop
  return hidden > KEYBOARD_MIN ? Math.round(hidden) : 0
}

export interface Keyboard {
  /** How far the keyboard reaches up into the window; 0 when none is up. */
  inset: number
  /** The height left visible above it. */
  visibleHeight: number
}

const NONE: Keyboard = { inset: 0, visibleHeight: 0 }

/**
 * The on-screen keyboard while `active` (a sheet open, say), followed as it
 * comes, goes or changes height (window.visualViewport). Where the browser has
 * no visual viewport it is never up.
 */
export function useKeyboard(active: boolean): Keyboard {
  const [keyboard, setKeyboard] = useState<Keyboard>(NONE)
  useEffect(() => {
    const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
    if (!active || !viewport) {
      setKeyboard(NONE)
      return
    }
    const update = () => {
      const inset = keyboardInset(window.innerHeight, viewport)
      setKeyboard((k) => (k.inset === inset && k.visibleHeight === viewport.height ? k : { inset, visibleHeight: viewport.height }))
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [active])
  return keyboard
}
