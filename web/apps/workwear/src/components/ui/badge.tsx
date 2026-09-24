import { type VariantProps, cva } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * A small status label.
 *
 * Mirrors the registry component's variant names — default, secondary,
 * destructive, outline — so markup written against shadcn's docs works here
 * unchanged. The registry's implementation renders through Base UI's
 * `useRender`; this one is a plain span, because nothing in this app needs a
 * badge to take over another element's tag.
 */
const badgeVariants = cva(
  cn(
    'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden',
    'whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
    '[&>svg]:pointer-events-none [&>svg]:size-3',
  ),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-muted text-muted-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'border border-border text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type BadgeProps = ComponentProps<'span'> & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { badgeVariants }
