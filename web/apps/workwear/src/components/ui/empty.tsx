import { type VariantProps, cva } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * An empty state.
 *
 * Composition follows the registry: `Empty` wraps an `EmptyHeader` — itself
 * holding `EmptyMedia`, `EmptyTitle`, `EmptyDescription` — plus an optional
 * `EmptyContent` for actions. That is more parts than a single div, and the
 * reason is that this app has three distinct empty states (nothing created yet,
 * a filter matching nothing, and a role that cannot create) which previously
 * drifted apart in padding and wording. Shared parts keep them consistent.
 */
export function Empty({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty"
      className={cn(
        'flex w-full min-w-0 flex-col items-center justify-center gap-4 text-balance',
        'rounded-lg border border-dashed border-border p-8 text-center',
        className,
      )}
      {...props}
    />
  )
}

export function EmptyHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-header"
      className={cn('flex max-w-sm flex-col items-center gap-2', className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  'flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'text-muted-foreground [&_svg]:size-8',
        // A tinted rounded tile, for an empty state that deserves more weight.
        icon: 'size-10 rounded-lg bg-muted text-muted-foreground [&_svg]:size-5',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type EmptyMediaProps = ComponentProps<'div'> & VariantProps<typeof emptyMediaVariants>

export function EmptyMedia({ className, variant, ...props }: EmptyMediaProps) {
  return (
    <div
      data-slot="empty-media"
      data-variant={variant ?? 'default'}
      className={cn(emptyMediaVariants({ variant }), className)}
      {...props}
    />
  )
}

export function EmptyTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="empty-title" className={cn('font-medium', className)} {...props} />
}

export function EmptyDescription({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export function EmptyContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="empty-content"
      className={cn('flex flex-col items-center gap-2', className)}
      {...props}
    />
  )
}

export { emptyMediaVariants }
