import { AlertTriangle, ChevronRight, RefreshCw } from 'lucide-react'
import { type ReactNode, useId } from 'react'

import { Button } from './button.tsx'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card.tsx'
import { uiText } from '../text.ts'
import { cn } from '../lib/utils.ts'

/*
 * The pieces of a dashboard-like screen: a panel for each section, the row
 * of headline figures and their tiles, and Refresh.
 */

/** A dashboard section: a card whose title is a level-2 heading, and a region named by it. */
export function Panel({
  title,
  description,
  className,
  anchor,
  descriptionClassName,
  children,
}: {
  title: string
  description?: ReactNode
  /** Such as `max-md:hidden`, where the phone needs the height. */
  descriptionClassName?: string
  className?: string | undefined
  /** A name to jump to it by (data-panel), for a tile that leads here. */
  anchor?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <Card
      className={cn('transition-colors duration-700 data-flash:bg-accent/60', className)}
      role="region"
      aria-labelledby={id}
      {...(anchor ? { 'data-panel': anchor } : {})}
    >
      <CardHeader>
        <CardTitle>
          <h2 id={id}>{title}</h2>
        </CardTitle>
        {description ? <CardDescription className={descriptionClassName}>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** Refresh for a dashboard: an icon on a phone, where the header has little room; labelled wider. */
export function RefreshButton({ loading, onClick }: { loading: boolean; onClick: () => void }) {
  return (
    <Button variant="outline" onClick={onClick} disabled={loading} title={uiText().refresh} className="max-md:size-11 max-md:px-0">
      <RefreshCw aria-hidden className={cn(loading && 'animate-spin')} />
      <span className="max-md:sr-only">{uiText().refresh}</span>
    </Button>
  )
}

/** The row of headline figures. */
export function KeyFigures({ children }: { children: ReactNode }) {
  return (
    // Two by two on a phone, in compact tiles: the four figures take about a fifth of the first screen, leaving it to what needs doing.
    <ul aria-label={uiText().keyFigures} className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
      {children}
    </ul>
  )
}

/**
 * A headline figure. With onOpen it is one button, the whole tile: it goes to
 * the list behind the figure (the rows in Needs you, History, Employees), and
 * a chevron says so. Without, it only reports. With `pressed` it is a filter
 * of the list below it instead (Company Assets' tiles): a toggle button,
 * marked while chosen, with no chevron.
 *
 * On a phone a tile is one fact beside the figure: `brief`, or else the
 * comparison. The full detail then stays for screen readers and shows from md.
 */
export function Kpi({
  label,
  value,
  detail,
  brief,
  change,
  alert = false,
  onOpen,
  openHint,
  pressed,
}: {
  label: string
  value: string
  detail: string
  /** The phone's one fact beside the figure, e.g. "oldest 12 days"; the comparison when absent. */
  brief?: string
  change?: string
  alert?: boolean
  onOpen?: (() => void) | undefined
  /** Where the tile goes, for screen readers: "Show them in Needs you". */
  openHint?: string
  /** The tile filters the list below and is chosen (true) or not (false). */
  pressed?: boolean | undefined
}) {
  const filter = pressed !== undefined
  const note = brief ?? (change || undefined)
  const body = (
    <Card
      size="sm"
      className={cn('h-full', onOpen && 'transition-colors group-hover:bg-accent/60', pressed && 'bg-accent ring-2 ring-primary group-hover:bg-accent')}
    >
      <CardContent className="flex flex-col gap-1 max-md:gap-0.5">
        <span className="flex items-center gap-1.5 text-muted-foreground max-md:text-xs">
          <span className="min-w-0 truncate">{label}</span>
          {alert ? <AlertTriangle aria-label={uiText().needsAttention} className="size-3.5 shrink-0 text-destructive" /> : null}
          {onOpen && !filter ? <ChevronRight aria-hidden className="ml-auto size-4 shrink-0" /> : null}
        </span>
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-semibold tracking-tight tabular-nums max-md:text-xl">{value}</span>
          {/* The same words as the detail below, which screen readers get in full. */}
          {note ? (
            <span aria-hidden className="text-xs text-muted-foreground md:hidden">
              {note}
            </span>
          ) : null}
        </span>
        <span className={cn('text-xs text-muted-foreground', note && 'max-md:sr-only')}>
          {detail}
          {change ? <span className="block">{change}</span> : null}
        </span>
        {onOpen && openHint ? <span className="sr-only">. {openHint}</span> : null}
      </CardContent>
    </Card>
  )
  return (
    <li>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-pressed={pressed}
          className="group block h-full w-full cursor-pointer rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {body}
        </button>
      ) : (
        body
      )}
    </li>
  )
}
