import type { VariantProps } from 'class-variance-authority'
import { useId } from 'react'

import { cn } from '../lib/utils.ts'
import { Badge, badgeVariants } from './badge.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'
import { HelpBody, type HelpItem, HelpNote, HelpTooltip, helpText } from './tooltip.tsx'

/** A status badge's words: with the number of issues in brackets when there is more than one, "Incomplete (2)". */
export function issueLabel(label: string, issues: number): string {
  return issues > 1 ? `${label} (${issues})` : label
}

/**
 * A status badge that explains itself: the issues and warnings behind its
 * state (Incomplete, Inactive, Blocked, Missing…), each a numbered row under
 * the badge's words, with a rule between them (HelpBody), and an optional note
 * below. The badge counts them when there is more than one. Without issues it
 * is a plain Badge.
 *
 * opens makes it a button, for a page or a pane: pointing at it, a tap, a click
 * or Enter opens the list in a panel. Without it the list is a tooltip, for a
 * list row: a phone's row opens its record, so it holds no buttons, and the
 * record's own badge opens. Either way a screen reader hears the list as the
 * badge's description.
 */
export function IssueBadge({
  label,
  variant,
  issues,
  note,
  opens = false,
  className,
}: {
  label: string
  variant?: VariantProps<typeof badgeVariants>['variant']
  issues: readonly HelpItem[]
  note?: string | undefined
  opens?: boolean
  className?: string | undefined
}) {
  const descriptionId = useId()
  if (issues.length === 0) {
    return (
      <Badge variant={variant} className={className}>
        {label}
      </Badge>
    )
  }
  const text = issueLabel(label, issues.length)
  // Always a list, one issue too: every badge's issues start at the same place.
  const help = note ? { body: issues, note, list: true } : { body: issues, list: true }
  if (!opens) {
    return (
      <HelpTooltip title={text} help={help}>
        <Badge variant={variant} className={className}>
          {text}
        </Badge>
      </HelpTooltip>
    )
  }
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={300}
        aria-describedby={descriptionId}
        className={cn(
          badgeVariants({ variant }),
          // A touch target of 44px around the small badge, as for every control.
          'relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3',
          className,
        )}
      >
        {text}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-72 max-w-[calc(100vw-2rem)] gap-0 px-3 py-2.5">
        <p className="font-medium">{text}</p>
        <HelpBody body={issues} list />
        {note ? <HelpNote note={note} list /> : null}
      </PopoverContent>
      <span id={descriptionId} hidden>
        {helpText(help)}
      </span>
    </Popover>
  )
}
