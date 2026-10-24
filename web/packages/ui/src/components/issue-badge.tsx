import type { VariantProps } from 'class-variance-authority'
import { use } from 'react'

import { cn } from '../lib/utils.ts'
import { Badge, badgeVariants } from './badge.tsx'
import { type HelpItem, HelpPopover, HelpTooltip, InControl } from './tooltip.tsx'

/** A status badge's words: with the number of issues in brackets when there is more than one, "Incomplete (2)". */
export function issueLabel(label: string, issues: number): string {
  return issues > 1 ? `${label} (${issues})` : label
}

/**
 * A status badge that explains itself: the issues and warnings behind its
 * state (Incomplete, Inactive, Blocked, Missing…), each a numbered row under
 * the badge's words, with an optional note below; it counts them when there
 * is more than one. Without issues it is a plain Badge.
 *
 * On a page or a pane it is a button: pointing at it, a tap, a click or Enter
 * opens the list (HelpPopover). Inside a control that takes the click itself
 * (InControl: a table row that opens its record, a choice button) it is a
 * tooltip, since a button may not hold a button. A screen reader hears the
 * list as the badge's description either way.
 */
export function IssueBadge({
  label,
  variant,
  issues,
  note,
  className,
}: {
  label: string
  variant?: VariantProps<typeof badgeVariants>['variant']
  issues: readonly HelpItem[]
  note?: string | undefined
  className?: string | undefined
}) {
  const inControl = use(InControl)
  if (issues.length === 0) {
    return (
      <Badge variant={variant} className={className}>
        {label}
      </Badge>
    )
  }
  const text = issueLabel(label, issues.length)
  const help = { body: issues, note }
  if (inControl) {
    return (
      <HelpTooltip title={text} help={help}>
        <Badge variant={variant} className={className}>
          {text}
        </Badge>
      </HelpTooltip>
    )
  }
  return (
    <HelpPopover
      title={text}
      help={help}
      className={cn(
        badgeVariants({ variant }),
        // A touch target of 44px around the small badge, as for every control.
        'relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3',
        className,
      )}
    >
      {text}
    </HelpPopover>
  )
}
