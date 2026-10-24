import type { ComponentProps } from 'react'

import { cn } from '../lib/utils.ts'

/**
 * A flat list: a rule between consecutive items, none above the first or below
 * the last, and the same room above and below each item. The detail panes'
 * lists (price steps, orders, item sets, assignments), Changes and a badge's
 * issues all use it, so their rows sit alike. ordered makes it an <ol>.
 */
const RULED = 'divide-y divide-border [&>li]:py-2 [&>li:first-child]:pt-0 [&>li:last-child]:pb-0'

export function RuleList({ ordered = false, className, ...props }: ComponentProps<'ul'> & { ordered?: boolean }) {
  return ordered ? <ol className={cn(RULED, className)} {...(props as ComponentProps<'ol'>)} /> : <ul className={cn(RULED, className)} {...props} />
}
