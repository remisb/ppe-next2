import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { Info } from 'lucide-react'
import { type ComponentProps, type ReactElement, type ReactNode, createContext, useId, useRef, useState } from 'react'

import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx'
import { RuleList } from './rule-list.tsx'

/**
 * An explanation shown while the pointer rests on, or keyboard focus is in,
 * its trigger, on Base UI's Tooltip. Hover and focus only: a touch screen
 * never shows it, so it may only add to what the screen already says, and
 * Base UI leaves it out of the accessibility tree, so the trigger names the
 * same words itself (aria-describedby). A card, not a dark label: it holds a
 * sentence or two, so it is set like the popover.
 */
function Tooltip(props: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

/** How long the pointer rests before help opens, so a pointer passing over a row of tiles opens none. */
const HELP_DELAY = 300

/** Opens after a short rest (HELP_DELAY). */
function TooltipTrigger({ delay = HELP_DELAY, ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" delay={delay} {...props} />
}

function TooltipContent({
  className,
  align = 'center',
  side = 'top',
  sideOffset = 8,
  container,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'> &
  Pick<ComponentProps<typeof TooltipPrimitive.Portal>, 'container'>) {
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Positioner align={align} side={side} sideOffset={sideOffset} collisionPadding={8} className="isolate z-50">
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          className={cn(
            'z-50 w-max max-w-72 origin-(--transform-origin) rounded-lg bg-popover px-3 py-2.5 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100',
            'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
            'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            'motion-reduce:animate-none',
            className,
          )}
          {...props}
        >
          {children}
          {/* A small point at the tile, in the card's colour and ring. */}
          <TooltipPrimitive.Arrow
            className={cn(
              'size-2.5 rotate-45 bg-popover',
              'data-[side=top]:-bottom-[5px] data-[side=top]:border-r data-[side=top]:border-b',
              'data-[side=bottom]:-top-[5px] data-[side=bottom]:border-t data-[side=bottom]:border-l',
              'data-[side=left]:-right-[5px] data-[side=left]:border-t data-[side=left]:border-r',
              'data-[side=right]:-left-[5px] data-[side=right]:border-b data-[side=right]:border-l',
              'border-foreground/10',
            )}
          />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

/** The column a list's numbers (and its note's ⓘ) sit in: every item's text starts after it. */
const MARKER = 'mt-px flex size-5 shrink-0 items-center justify-center'

/** One item of a help list: a line, or a short title (what is wrong) with its detail (how to put it right) below. */
export type HelpItem = string | { title: string; detail?: string }

/** What a figure or a choice means (body) and, set apart below it, a note such as how it relates to the others. */
export interface Help {
  /**
   * A string is a paragraph (a tab's or a tile's explanation); a list (a status
   * badge's issues) is numbered rows, one item too, so every list starts its
   * text at the same place however many items it holds.
   */
  body: string | readonly HelpItem[]
  note?: string | undefined
}

/** The words of help as one sentence run, for a screen reader (the trigger's description). */
export function helpText(help: Help): string {
  const items = typeof help.body === 'string' ? [help.body] : help.body
  return [...items.map((i) => (typeof i === 'string' ? i : [i.title, i.detail].filter(Boolean).join(' '))), help.note]
    .filter(Boolean)
    .join(' ')
}

/**
 * True inside a control that takes the click itself, such as a table row that
 * opens its record or a choice button: help there is a tooltip, never a button
 * of its own, since a button may not hold a button (IssueBadge). TableRow sets it.
 */
export const InControl = createContext(false)

function HelpItemText({ item, className }: { item: HelpItem; className?: string }) {
  if (typeof item === 'string') return <p className={cn('text-muted-foreground', className)}>{item}</p>
  return (
    <div className={className}>
      <p className="font-medium">{item.title}</p>
      {item.detail ? <p className="text-muted-foreground">{item.detail}</p> : null}
    </div>
  )
}

/**
 * Help's body under its title: a string a paragraph; a list numbered rows with
 * a rule between consecutive rows only (RuleList), so how many there are and
 * where each starts and ends show at a glance.
 */
export function HelpBody({ body }: { body: Help['body'] }) {
  if (typeof body === 'string') return <HelpItemText item={body} className="mt-1" />
  return (
    <RuleList ordered className="mt-2">
      {body.map((item, n) => (
        <li key={n} className="flex gap-2">
          <span aria-hidden className={cn(MARKER, 'rounded-full bg-muted text-xs font-medium text-foreground tabular-nums')}>
            {n + 1}
          </span>
          <HelpItemText item={item} className="min-w-0" />
        </li>
      ))}
    </RuleList>
  )
}

/** Help's note, set apart below its body by a rule, its ⓘ in the numbers' column so its text lines up with a list's. */
export function HelpNote({ note }: { note: string }) {
  return (
    <p className="mt-2.5 flex gap-2 border-t border-border pt-2.5 text-xs text-muted-foreground">
      <span aria-hidden className={MARKER}>
        <Info className="size-3.5 text-foreground" />
      </span>
      <span>{note}</span>
    </p>
  )
}

/** Help as a tooltip or a panel shows it: the title, the body, the note below a rule. */
function HelpContent({ title, help }: { title?: string | undefined; help: Help }) {
  return (
    <>
      {title ? <p className="font-medium">{title}</p> : null}
      <HelpBody body={help.body} />
      {help.note ? <HelpNote note={help.note} /> : null}
    </>
  )
}

/**
 * children, explained in a tooltip: a heading (title), the body and the note
 * below a rule. Screen readers get the same words as children's description,
 * from a hidden element beside it. children must take a ref and props (a
 * button, a div); it opens below by default, as such controls head a screen.
 * Hover and focus only: where a tap must open it too, use HelpPopover.
 */
function HelpTooltip({
  title,
  help,
  side = 'bottom',
  children,
}: {
  title: string
  help: Help
  side?: TooltipPrimitive.Positioner.Props['side']
  children: ReactElement
}) {
  const id = useId()
  return (
    <>
      <Tooltip>
        <TooltipTrigger render={children} aria-describedby={id} />
        <TooltipContent aria-hidden side={side}>
          <HelpContent title={title} help={help} />
        </TooltipContent>
      </Tooltip>
      <span id={id} hidden>
        {helpText(help)}
      </span>
    </>
  )
}

/**
 * Help a tap opens too: a button (children are its face, className its look)
 * opening a panel with the help below it. Pointing at it opens it as a tooltip
 * would (after the tooltip's 300 ms), and a click, a tap or Enter opens it and
 * keeps it open until Escape or a click elsewhere: a Popover that also opens
 * on hover, as a Tooltip never shows on touch. A screen reader hears the help
 * as the button's description. The status badges on a page (IssueBadge) and
 * a section's ⓘ (InfoTip) are made of it.
 */
function HelpPopover({
  title,
  help,
  label,
  describedBy,
  focusable = true,
  className,
  children,
}: {
  title?: string | undefined
  help: Help
  /** The button's name, when its face is an icon. */
  label?: string | undefined
  /** An element on the page that already holds the help's words, to describe the button by instead of a copy. */
  describedBy?: string | undefined
  /** False keeps the button out of the Tab order, where its words reach a screen reader another way (FormSheet's ⓘ). */
  focusable?: boolean | undefined
  className?: string | undefined
  children: ReactNode
}) {
  const ownId = useId()
  const id = describedBy ?? ownId
  const trigger = useRef<HTMLButtonElement>(null)
  // Inside a FormSheet's modal <dialog> the panel opens in it, or it would be beneath it (see Popover).
  const [container, setContainer] = useState<HTMLElement | null>(null)
  return (
    <Popover onOpenChange={(open) => open && setContainer(trigger.current?.closest('dialog') ?? null)}>
      <PopoverTrigger
        ref={trigger}
        openOnHover
        delay={HELP_DELAY}
        aria-label={label}
        aria-describedby={id}
        tabIndex={focusable ? undefined : -1}
        className={className}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent
        container={container ?? undefined}
        side="bottom"
        align="start"
        className="max-w-[calc(100vw-2rem)] gap-0 px-3 py-2.5"
        // Escape closes the help only: kept from a FormSheet's <dialog>, whose cancel would close the sheet too.
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.preventDefault()
        }}
      >
        <HelpContent title={title} help={help} />
      </PopoverContent>
      {describedBy ? null : (
        <span id={id} hidden>
          {helpText(help)}
        </span>
      )}
    </Popover>
  )
}

export { HelpPopover, HelpTooltip, Tooltip, TooltipContent, TooltipTrigger }
