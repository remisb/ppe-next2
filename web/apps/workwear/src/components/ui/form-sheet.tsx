import { X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'

import { cn } from '@/lib/utils'

import { Button } from './button'

interface FormSheetProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children: ReactNode
  /** Pinned to the bottom of the viewport on a phone so a long form saves without scrolling. */
  footer?: ReactNode
}

/**
 * A modal that is a bottom sheet on a phone and a centred dialog from `md:`.
 *
 * Distinct from the registry's `Sheet`, an edge-anchored side panel with a
 * trigger/portal API. Named to match the issue app, so the two agree.
 *
 * Built on `<dialog>` rather than a portal-and-focus-trap of our own: the
 * platform gives modal semantics, focus containment, the top layer, and Escape
 * for free, and all four are easy to get subtly wrong by hand.
 */
export function FormSheet({ open, onClose, title, description, children, footer }: FormSheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  /*
   * Per instance, not a constant. `ResourceScreen` can mount two of these at
   * once — an edit sheet and a delete confirmation are independent state — and
   * two elements sharing one id makes `aria-labelledby` resolve to whichever
   * comes first in the document, so a screen reader announces the wrong title.
   */
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  // Escape fires `cancel`, not `close`, and would otherwise dismiss the dialog
  // natively while this component still believes it is open.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return

    const onCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    dialog.addEventListener('cancel', onCancel)
    return () => dialog.removeEventListener('cancel', onCancel)
  }, [onClose])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn(
        // The phone form: full width, pinned to the bottom, rounded at the top.
        'w-full max-w-none m-0 mt-auto rounded-t-lg bg-card p-0 text-card-foreground',
        'max-h-[92dvh] backdrop:bg-black/50',
        // From md: a centred dialog of bounded width.
        'md:m-auto md:max-w-2xl md:rounded-lg md:max-h-[85dvh]',
      )}
    >
      {/* h-full + min-h-0 so the body scrolls rather than the footer sliding off. */}
      <div className="flex max-h-[inherit] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X aria-hidden />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>

        {footer ? (
          <footer
            className={cn(
              'flex flex-col-reverse gap-2 border-t border-border p-4',
              'sm:flex-row sm:justify-end',
              // Clears the home bar on a notched phone.
              'pb-[max(1rem,env(safe-area-inset-bottom))] md:pb-4',
            )}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  )
}
