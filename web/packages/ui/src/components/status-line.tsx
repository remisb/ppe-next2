import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

const tones = {
  muted: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
}

/**
 * A ruled status line, not a box (guidelines, "Flat, ruled, not boxed"): an
 * icon coloured by its tone, what it says, and an action at its end that wraps
 * under it where the line is short. The words carry the state; the tone only
 * colours the icon. For a list of them, put each in a RuleList item with
 * `ruled={false}`.
 */
export function StatusLine({
  icon,
  tone = 'muted',
  action,
  ruled = true,
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & {
  icon?: ReactNode
  tone?: keyof typeof tones
  action?: ReactNode
  ruled?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 text-sm', ruled && 'border-y border-border py-3', className)} {...props}>
      {icon ? <span className={cn('mt-0.5 shrink-0 [&>svg]:size-5', tones[tone])}>{icon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </div>
  )
}
