import { useSyncExternalStore } from 'react'

/** A phone's width: below Tailwind's md (48rem), where the screens take their phone layout. */
const PHONE = '(max-width: 47.99rem)'

function subscribe(changed: () => void): () => void {
  const query = window.matchMedia(PHONE)
  query.addEventListener('change', changed)
  return () => query.removeEventListener('change', changed)
}

/** Whether the window is a phone's width now; follows it as the window turns or is resized. */
export function usePhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  )
}
