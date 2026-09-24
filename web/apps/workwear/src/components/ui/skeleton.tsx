import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * A loading placeholder.
 *
 * Follows the registry component's shape — a `data-slot` and nothing but a
 * className — so a future `shadcn add skeleton` is a drop-in. The utilities are
 * ours rather than the registry's `cn-*` theme classes, which belong to a layer
 * this app does not install.
 *
 * `bg-muted` rather than a literal grey: the token differs per theme, and a
 * fixed grey is invisible on one of them.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  )
}
