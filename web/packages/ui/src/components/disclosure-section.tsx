import { ChevronDown } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useRememberedOpen } from '../lib/remembered-open.ts'
import { cn } from '../lib/utils.ts'
import { InfoTip } from './info-tip.tsx'

/**
 * A page section whose heading opens and closes it, closed at first. Its body
 * mounts only while open, so whatever it loads is read once it is opened.
 * count, when given, shows beside the title so a closed section still says how
 * much it holds. description explains the section without taking room: an ⓘ
 * beside the heading that opens it (InfoTip), and the heading button's
 * description for a screen reader. action, such as a Give button, sits beside
 * the title, outside the toggle, before the ⓘ.
 * rememberAs keeps it as it was left, under that storage key (useRememberedOpen).
 * open with onOpenChange makes it controlled, for a page that opens it itself.
 */
export function DisclosureSection({
  id,
  title,
  count,
  description,
  action,
  defaultOpen = false,
  rememberAs,
  open: openProp,
  onOpenChange,
  className,
  children,
}: {
  /** The heading's id; the section is labelled by it. */
  id: string
  title: string
  count?: number | undefined
  description?: string | undefined
  action?: ReactNode
  defaultOpen?: boolean
  rememberAs?: string | undefined
  open?: boolean | undefined
  onOpenChange?: ((open: boolean) => void) | undefined
  /** Replaces the room below it (mb-1 closed, so closed sections stack closely; mb-6 open). */
  className?: string | undefined
  children: ReactNode
}) {
  const [openState, setOpenState] = useRememberedOpen(rememberAs, defaultOpen)
  const open = openProp ?? openState
  const toggle = () => {
    setOpenState(!open)
    onOpenChange?.(!open)
  }
  const bodyId = useId()
  const descriptionId = useId()
  const beside = action || description
  const heading = (
    <h2 id={id} className={cn('text-lg font-semibold', beside ? 'min-w-0 flex-1' : 'mb-1')}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-describedby={description ? descriptionId : undefined}
        onClick={toggle}
        className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-baseline gap-2">
          {title}
          {count === undefined ? null : <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}</span>}
        </span>
        <ChevronDown aria-hidden className={cn('size-5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', open && 'rotate-180')} />
      </button>
    </h2>
  )
  return (
    <section aria-labelledby={id} className={cn(open ? 'mb-6' : 'mb-1', className)}>
      {beside ? (
        <div className="mb-1 flex items-center gap-3">
          {heading}
          {action}
          {description ? (
            <InfoTip section={title} describedBy={descriptionId}>
              {description}
            </InfoTip>
          ) : null}
        </div>
      ) : (
        heading
      )}
      {/* Hidden, yet a description still: kept out of the heading, which names the section. */}
      {description ? (
        <p id={descriptionId} hidden>
          {description}
        </p>
      ) : null}
      <div id={bodyId} className="empty:hidden">
        {open ? children : null}
      </div>
    </section>
  )
}
