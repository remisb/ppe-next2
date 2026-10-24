import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { Info } from 'lucide-react'
import { type ComponentProps, type ReactElement, useId } from 'react'

import { cn } from '../lib/utils.ts'

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

/** Opens after a short rest (300 ms), so a pointer passing over a row of tiles opens none. */
function TooltipTrigger({ delay = 300, ...props }: TooltipPrimitive.Trigger.Props) {
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
  /** Several items are listed one per row, numbered (one per problem, say). */
  body: string | readonly HelpItem[]
  note?: string
  /**
   * A list of issues (a status badge's): always numbered rows, one item too,
   * and the note's text in line with theirs, so every badge's list starts its
   * text at the same place however many issues it holds.
   */
  list?: boolean
}

/** The words of help as one sentence run, for a screen reader (the trigger's description). */
export function helpText(help: Help): string {
  const items = typeof help.body === 'string' ? [help.body] : help.body
  return [...items.map((i) => (typeof i === 'string' ? i : [i.title, i.detail].filter(Boolean).join(' '))), help.note]
    .filter(Boolean)
    .join(' ')
}

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
 * Help's body under its title. One item reads as a paragraph; several, or any
 * number with list, are a numbered list with a rule between consecutive items
 * only (none above the first or below the last), so how many there are and
 * where each starts and ends show at a glance. The same in a tooltip and in a
 * panel opened from a badge, so every badge's help looks alike.
 */
export function HelpBody({ body, list = false }: { body: Help['body']; list?: boolean | undefined }) {
  const items = typeof body === 'string' ? [body] : body
  if (items.length === 1 && !list) return <HelpItemText item={items[0]!} className="mt-1" />
  return (
    <ol className="mt-2 divide-y divide-border">
      {items.map((item, n) => (
        <li key={n} className="flex gap-2 py-2 first:pt-0 last:pb-0">
          <span aria-hidden className={cn(MARKER, 'rounded-full bg-muted text-xs font-medium text-foreground tabular-nums')}>
            {n + 1}
          </span>
          <HelpItemText item={item} className="min-w-0" />
        </li>
      ))}
    </ol>
  )
}

/** Help's note, set apart below its body by a rule; with list, its ⓘ in the numbers' column, so its text lines up with the items'. */
export function HelpNote({ note, list = false }: { note: string; list?: boolean | undefined }) {
  return (
    <p className="mt-2.5 flex gap-2 border-t border-border pt-2.5 text-xs text-muted-foreground">
      {list ? (
        <span aria-hidden className={MARKER}>
          <Info className="size-3.5 text-foreground" />
        </span>
      ) : (
        <Info aria-hidden className="mt-px size-3.5 shrink-0 text-foreground" />
      )}
      <span>{note}</span>
    </p>
  )
}

/**
 * children, explained in a tooltip: a heading (title), the body and the note
 * below a rule. Screen readers get the same words as children's description,
 * from a hidden element beside it. children must take a ref and props (a
 * button, a div); it opens below by default, as such controls head a screen.
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
          <p className="font-medium">{title}</p>
          <HelpBody body={help.body} list={help.list} />
          {help.note ? <HelpNote note={help.note} list={help.list} /> : null}
        </TooltipContent>
      </Tooltip>
      <span id={id} hidden>
        {helpText(help)}
      </span>
    </>
  )
}

export { HelpTooltip, Tooltip, TooltipContent, TooltipTrigger }
