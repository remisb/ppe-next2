import { AlertCircle } from 'lucide-react'
import type { ReactNode } from 'react'

import { type Loaded as Load, errorText } from '../lib/use-load.ts'
import { uiText } from '../text.ts'
import { Alert, AlertDescription, AlertTitle } from './alert.tsx'
import { Button } from './button.tsx'
import { Skeleton } from './skeleton.tsx'

/** An error with a Retry action; the screen's own state is untouched. */
export function ErrorState({
  error,
  onRetry,
  title,
  retryLabel,
  className,
}: {
  error: unknown
  onRetry?: (() => void) | undefined
  title?: string | undefined
  retryLabel?: string
  className?: string | undefined
}) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle aria-hidden />
      <AlertTitle>{title ?? uiText().couldNotLoad}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{errorText(error)}</span>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {retryLabel ?? uiText().retry}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

/** An action's failure (useAction), above what it acted on; nothing when there is none. */
export function ActionError({
  error,
  title,
  onRetry,
  className,
}: {
  error: unknown
  title?: string | undefined
  onRetry?: (() => void) | undefined
  className?: string | undefined
}) {
  if (error === undefined || error === null) return null
  return <ErrorState title={title ?? uiText().actionFailed} error={error} onRetry={onRetry} className={className} />
}

export function Loading({ label }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label ?? uiText().loading}</p>
}

/**
 * A list's first load: grey rows the shape of the list, fading down, instead of
 * the word; a screen reader hears "Loading…". Loading again keeps the list on
 * screen instead, dimmed (Table's `busy`).
 */
export function ListSkeleton({ rows = 5, label }: { rows?: number; label?: string | undefined }) {
  return (
    <div role="status" className="grid gap-2 py-2">
      <span className="sr-only">{label ?? uiText().loading}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} aria-hidden className="h-11" style={{ opacity: 1 - i / (rows + 1) }} />
      ))}
    </div>
  )
}

export { PageHeader } from './page-header.tsx'

/** An empty list or search: a dashed box with an optional next step. */
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      <p>{children}</p>
      {action}
    </div>
  )
}

/**
 * What a load shows, in one place: its error with Retry, a ListSkeleton while
 * there is nothing to show yet, the empty state when `empty` says there is nothing (an
 * empty list, by default), else children(data). Loading again keeps the data on
 * screen.
 */
export function Loaded<T>({
  load,
  empty,
  emptyState,
  loadingLabel,
  children,
}: {
  load: Load<T>
  empty?: boolean | ((data: Exclude<T, undefined>) => boolean)
  emptyState?: ReactNode
  loadingLabel?: string | undefined
  children: (data: Exclude<T, undefined>) => ReactNode
}) {
  if (load.error) return <ErrorState error={load.error} onRetry={load.reload} />
  if (load.data === undefined) return <ListSkeleton label={loadingLabel} />
  const data = load.data as Exclude<T, undefined>
  const nothing = typeof empty === 'function' ? empty(data) : (empty ?? (Array.isArray(data) && data.length === 0))
  if (emptyState !== undefined && nothing) return <EmptyState>{emptyState}</EmptyState>
  return children(data)
}
