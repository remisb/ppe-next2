import type { ComponentProps } from 'react'

import { cn } from '@/lib/utils'

/**
 * A rule between sections. Replaces `<div className="border-t">`, which is the
 * same thing without the semantics.
 *
 * `decorative` is the default and the common case: a line that only separates
 * visually should be hidden from screen readers rather than announced. Pass
 * `decorative={false}` when the division carries meaning.
 */
export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: ComponentProps<'div'> & {
  orientation?: 'horizontal' | 'vertical'
  decorative?: boolean
}) {
  return (
    <div
      data-slot="separator"
      data-orientation={orientation}
      role={decorative ? 'none' : 'separator'}
      aria-orientation={decorative ? undefined : orientation}
      className={cn(
        'shrink-0 bg-border',
        orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
        className,
      )}
      {...props}
    />
  )
}
