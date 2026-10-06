import { AlertCircle } from 'lucide-react'

import { errorText } from '../lib/use-load.ts'
import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'
import { Alert, AlertDescription, AlertTitle } from './alert.tsx'
import { Button } from './button.tsx'

/** An error with a Retry action; the screen's own state is untouched. */
export function ErrorState({ error, onRetry, title, retryLabel }: { error: unknown; onRetry?: () => void; title?: string; retryLabel?: string }) {
  return (
    <Alert variant="destructive">
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

export function Loading({ label }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label ?? uiText().loading}</p>
}

/**
 * Title with the screen's main action beside it at every width; the
 * description runs underneath, so a phone keeps the action in reach.
 */
export function PageHeader({
  title,
  description,
  actions,
  icon,
  descriptionClassName,
}: {
  title: string
  description?: string
  /** Such as `max-md:hidden`, where the screen needs its height for content. */
  descriptionClassName?: string
  actions?: React.ReactNode
  /** A decorative mark before the title, such as an item's pictogram. */
  icon?: React.ReactNode
}) {
  return (
    <div className="mb-5 md:mb-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="flex items-center gap-3 text-xl font-semibold tracking-tight md:text-2xl">
          {icon}
          {title}
        </h1>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {description ? <p className={cn('mt-1 max-w-prose text-sm text-muted-foreground', descriptionClassName)}>{description}</p> : null}
    </div>
  )
}

/** An empty list or search: a dashed box with an optional next step. */
export function EmptyState({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      <p>{children}</p>
      {action}
    </div>
  )
}
