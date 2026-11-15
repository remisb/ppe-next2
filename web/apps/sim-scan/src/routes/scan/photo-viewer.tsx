import { simScanText } from '@ppe/sim-scan'
import { Button } from '@ppe/ui/components/button'
import { cn } from '@ppe/ui/lib/utils'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface Photo {
  /** What it shows: the card's front or back. */
  label: string
  src: string
}

/**
 * A card's photos, enlarged: full screen on black, the one tapped first, as
 * large as fits; its side named at the top with ×, and, when the card has
 * both, Front and Back to switch. Escape, × or a tap on the black around the
 * photo closes it. A modal <dialog> portalled to the page's body, so it opens
 * over the card's sheet (the topmost modal dialog takes input); the browser's
 * own pinch zooms further.
 */
export function PhotoViewer({ photos, start, onClose }: { photos: readonly Photo[]; start: number; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [shown, setShown] = useState(Math.min(start, photos.length - 1))
  const photo = photos[shown]

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    return () => d?.close()
  }, [])

  if (!photo) return null
  return createPortal(
    <dialog
      ref={dialog}
      aria-label={photo.label}
      className="dark m-0 h-dvh max-h-none w-full max-w-none border-0 bg-black p-0 text-white backdrop:bg-black"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="flex h-full flex-col pt-[env(safe-area-inset-top)] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 pr-2 pl-4">
          <span className="text-base font-semibold">{photo.label}</span>
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={simScanText().closePhoto} title={simScanText().closePhoto} onClick={onClose}>
            <X aria-hidden className="size-5" />
          </Button>
        </header>
        {/* The black around the photo closes it too, as a tap outside a sheet does. */}
        <div
          className="flex min-h-0 flex-1 items-center justify-center p-3"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <img key={photo.src} src={photo.src} alt={photo.label} className="max-h-full max-w-full rounded-lg object-contain motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200" />
        </div>
        {photos.length > 1 ? (
          <div className="flex shrink-0 justify-center gap-2 px-4 pt-2">
            {photos.map((p, i) => (
              <button
                key={p.label}
                type="button"
                aria-pressed={i === shown}
                onClick={() => setShown(i)}
                className={cn('h-11 rounded-full border px-5 text-sm font-medium', i === shown ? 'border-white bg-white text-black' : 'border-white/30 text-white')}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </dialog>,
    document.body,
  )
}
