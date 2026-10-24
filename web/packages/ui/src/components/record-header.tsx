import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

/**
 * A record's header in a pane or on its page (guidelines, "The detail pane"):
 * the title, the main action and ⋯ in the top right corner, then what is under
 * the title (a details line, the status badges). Where the title and the
 * actions do not fit one row, the title moves under them, never the actions
 * down (wrap-reverse). Beside a list it leaves the corner to Close.
 */
export function RecordHeader({
  title,
  actions,
  beside = true,
  className,
  children,
}: {
  /** The heading, usually a RecordTitle; the asset pane draws its numbers instead. */
  title: ReactNode
  actions?: ReactNode
  /** In a pane beside a list, whose Close sits in the corner. */
  beside?: boolean
  className?: string | undefined
  children?: ReactNode
}) {
  return (
    <header className={cn('mb-4', beside && 'lg:pr-10', className)}>
      <div className="flex flex-wrap-reverse items-center justify-between gap-x-3 gap-y-2">
        {title}
        {actions ? <div className="ml-auto flex shrink-0 gap-2">{actions}</div> : null}
      </div>
      {children}
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
