import { ArrowLeft, X } from 'lucide-react'
import { type ReactNode, useRef } from 'react'

import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'
import { useStuck } from '../lib/use-stuck.ts'
import { Button } from './button.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'

/** The ways out of a record, for its row: back to the list (below lg), and Close beside it. */
export interface RecordNav {
  /** The list's name: "Orders". */
  backLabel: string
  onBack: () => void
  /** "Close order", where the record is a pane beside its list; a page has none. */
  closeLabel?: string | undefined
}

/**
 * A record's header in a pane or on its page (guidelines, "The detail pane").
 * Its first row, the title with the main action and ⋯ in the corner, sticks:
 * inside the pane's own scroll beside a list, at the top of the screen on a
 * phone, a tablet and a record's page, where it covers the bar with the app's
 * name as a screen's PageHeader does. What is under the title (`children`: a
 * details line, the status badges) scrolls under it.
 *
 * With `nav`, the row also holds the way out: below lg back to the list as an
 * icon named "Back to Orders"; beside the list, Close
 * in the corner. PaneBar draws the same while the record loads, and hides
 * once this row is there (styles.css). Where the title and the actions do not
 * fit one row, the title moves under them, never the actions down.
 */
export function RecordHeader({
  title,
  actions,
  beside = true,
  nav,
  className,
  children,
}: {
  /** The heading, usually a RecordTitle; the asset pane draws its numbers instead. */
  title: ReactNode
  actions?: ReactNode
  /** In a pane beside a list (from lg), whose own scroll the row sticks in; false on a record's page. */
  beside?: boolean
  nav?: RecordNav | undefined
  /** The details under the row: their spacing in the record. */
  className?: string | undefined
  children?: ReactNode
}) {
  const mark = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLDivElement>(null)
  useStuck(mark, row)
  return (
    // display: contents, no box of its own: the row sticks the length of the record, not of its header.
    <header className="contents">
      {/* In a record that spaces its parts with gap-4 (Orders, the Audit log), the mark and the row take none between them. */}
      <div ref={mark} aria-hidden className={cn('-mt-3 h-px md:-mt-8 print:hidden [.gap-4>*>&]:-mb-4', beside && 'lg:mt-0')} />
      <div
        ref={row}
        data-slot="record-header"
        className={cn(
          '-mt-px flex min-h-(--page-header) items-center gap-2 py-1.5',
          // A phone's and a tablet's screen: the top of the window, over the bar with the app's name.
          '-mx-4 sticky top-[env(safe-area-inset-top)] z-40 bg-background px-4 md:-mx-6 md:z-20 md:px-6',
          beside
            ? // Beside the list: the top of the pane's card, in its own scroll (-top-4: sticking keeps out of the card's padding otherwise).
              // As tall as the screen's header beside it (less the card's border), so the titles and the rules line up.
              'lg:-top-4 lg:-mx-4 lg:-mt-[calc(1rem+1px)] lg:min-h-[calc(var(--page-header)-1px)] lg:bg-card lg:px-4 lg:py-0'
            : undefined,
          'border-b border-transparent transition-[border-color,box-shadow] data-stuck:border-border data-stuck:shadow-sm',
          '[@media(height<30rem)]:static print:static print:mx-0 print:px-0',
          children ? undefined : cn('mb-4', className),
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap-reverse items-center justify-between gap-x-2 gap-y-1">
          <div className="flex min-w-0 items-center gap-1">
            {nav ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon" className="-ml-2.5 lg:hidden print:hidden" aria-label={uiText().backTo(nav.backLabel)} onClick={nav.onBack}>
                      <ArrowLeft aria-hidden />
                    </Button>
                  }
                />
                <TooltipContent aria-hidden>{uiText().backTo(nav.backLabel)}</TooltipContent>
              </Tooltip>
            ) : null}
            {title}
          </div>
          {/* A phone's buttons a little narrower, so a record number and its main action share the row. */}
          {actions ? <div className="ml-auto flex shrink-0 gap-2 print:hidden max-sm:[&>[data-slot=button]]:px-3">{actions}</div> : null}
        </div>
        {nav?.closeLabel ? (
          <Button variant="ghost" size="icon" className="-mr-2 max-lg:hidden" aria-label={nav.closeLabel} onClick={nav.onBack}>
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      {children ? <div className={cn('mb-4 [.gap-4>*>&]:-mt-3', className)}>{children}</div> : null}
    </header>
  )
}

/** A record's title: the pane's heading (h2), or the page's (h1), with an optional mark before it. */
export function RecordTitle({
  as: Heading = 'h2',
  icon,
  className,
  children,
}: {
  as?: 'h1' | 'h2'
  icon?: ReactNode
  className?: string | undefined
  children: ReactNode
}) {
  return (
    <Heading className={cn('flex min-w-0 items-center gap-3 text-xl font-semibold tracking-tight [overflow-wrap:anywhere]', className)}>
      {icon}
      {children}
    </Heading>
  )
}
