import { Info } from 'lucide-react'
import { useId } from 'react'

import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'

/**
 * An ⓘ beside a heading, holding the section's explanation out of the way.
 * Pointing at it opens it, as a tooltip would; a click, a tap or Enter opens
 * it too and keeps it open, since a touch screen has no pointing: a Popover
 * that also opens on hover, not a Tooltip, which never shows on touch. Escape,
 * or a click or tap elsewhere, closes it. A screen reader hears the text as the
 * button's description. label names the button ("About Orders"); keep it out
 * of the heading, so the heading's name stays its own.
 */
export function InfoTip({ label, children, className }: { label: string; children: string; className?: string }) {
  const descriptionId = useId()
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        aria-label={label}
        aria-describedby={descriptionId}
        className={cn(
          'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-muted data-[popup-open]:text-foreground pointer-coarse:size-11',
          className,
        )}
      >
        <Info aria-hidden className="size-4" />
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-72 max-w-[calc(100vw-2rem)] px-3 py-2.5 text-muted-foreground">
        {children}
      </PopoverContent>
      <span id={descriptionId} hidden>
        {children}
      </span>
    </Popover>
  )
}
