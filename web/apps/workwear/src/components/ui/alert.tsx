import { type VariantProps, cva } from 'class-variance-authority'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * A callout. Replaces the styled `role="alert"` divs this app used to hand-roll
 * in five places, each with slightly different padding.
 *
 * Composition matches the registry: `Alert` + `AlertTitle` + `AlertDescription`,
 * with `role="alert"` on the root so a screen reader announces it when it
 * appears. A description on its own is fine — most of this app's alerts are one
 * line and a title would be noise.
 */
const alertVariants = cva('relative w-full rounded-md border p-3 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-card text-card-foreground',
      // The token, not a literal red: its dark variant is lighter and more
      // saturated, because the light value dims to brown on a dark surface.
      destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export type AlertProps = ComponentProps<'div'> & VariantProps<typeof alertVariants>

export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('font-medium tracking-tight', className)}
      {...props}
    />
  )
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('text-sm', className)} {...props} />
}

export { alertVariants }
