import { ChevronDown, Ellipsis } from 'lucide-react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { type BarLayout, type RecordAction, layoutActions, menuGroups, sortActions } from '../lib/record-actions.ts'
import { ActionIcon, ActionMenuItems } from './action-menu.tsx'
import { cn } from '../lib/utils.ts'
import { Button, buttonVariants } from './button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from './dropdown-menu.tsx'
import { HelpTooltip, Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'

// The bar's fixed parts: 44px icon buttons (tools, ⋯, an icon-only main action) 8px apart (gap-2).
const ICON = 44
const GAP = 8

/** Whether a media query matches, following it as it changes. */
function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const on = () => setMatches(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return matches
}

/** A disabled control takes no pointer, so its tooltip hangs on a wrapper; a screen reader hears why from the control. */
function WithReason({ reason, children }: { reason: string; children: (describedBy: string) => ReactNode }) {
  const id = useId()
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children(id)}</TooltipTrigger>
      <TooltipContent aria-hidden>{reason}</TooltipContent>
      <span id={id} hidden>
        {reason}
      </span>
    </Tooltip>
  )
}

function MainButton({ action, step }: { action: RecordAction; step: BarLayout['step'] }) {
  const iconOnly = step === 'icon' && action.icon !== undefined
  const words = step === 'short' && action.short ? action.short : action.label
  const disabled = action.pending || action.disabledReason !== undefined
  const button = (describedBy?: string) => (
    <Button
      data-action={action.id}
      size={iconOnly ? 'icon' : 'default'}
      className={cn(!iconOnly && 'min-w-0')}
      disabled={disabled}
      aria-label={iconOnly || words !== action.label ? action.label : undefined}
      aria-describedby={describedBy}
      aria-expanded={action.expanded}
      aria-controls={action.controls}
      onClick={action.run}
    >
      <ActionIcon action={action} />
      {iconOnly ? null : <span className="min-w-0 truncate" aria-hidden={words !== action.label || undefined}>{words}</span>}
      {action.expanded !== undefined ? (
        <ChevronDown aria-hidden className={cn('transition-transform motion-reduce:transition-none', action.expanded && 'rotate-180')} />
      ) : null}
    </Button>
  )
  if (action.disabledReason) return <WithReason reason={action.disabledReason}>{button}</WithReason>
  if (action.help) {
    return (
      <HelpTooltip title={action.label} help={action.help}>
        {button()}
      </HelpTooltip>
    )
  }
  if (iconOnly || words !== action.label) {
    return (
      <Tooltip>
        <TooltipTrigger render={button()} />
        <TooltipContent aria-hidden>{action.label}</TooltipContent>
      </Tooltip>
    )
  }
  return button()
}

/** A tool: icon only, its name its accessible name and its tooltip on hover and focus. */
function ToolButton({ action }: { action: RecordAction }) {
  const button = (describedBy?: string) => (
    <Button
      data-action={action.id}
      variant="outline"
      size="icon"
      disabled={action.pending || action.disabledReason !== undefined}
      aria-label={action.label}
      aria-describedby={describedBy}
      onClick={action.run}
    >
      <ActionIcon action={action} />
    </Button>
  )
  if (action.disabledReason) return <WithReason reason={action.disabledReason}>{button}</WithReason>
  return (
    <Tooltip>
      <TooltipTrigger render={button()} />
      <TooltipContent aria-hidden>{action.label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * A record's actions in their own row under its title (docs/ux/record-actions.md,
 * Option B): the main action, filled, with its words; the tools, icon only;
 * ⋯ at the end with the rest, labelled. One line that never wraps: what does
 * not fit collapses in a fixed order (layoutActions), measured from the words
 * in the language in use, not from breakpoints. On a touch screen ⋯ names
 * every tool too, so no name is reachable by hover alone.
 */
export function ActionBar({ actions, moreLabel, className }: { actions: readonly RecordAction[]; moreLabel: string; className?: string | undefined }) {
  const sorted = sortActions(actions)
  const main = sorted.find((a) => a.place === 'main')
  const tools = sorted.filter((a) => a.place === 'tool')
  const hasMenu = sorted.some((a) => a.place === 'menu')

  const phone = useMedia('(width < 40rem)')
  const coarse = useMedia('(pointer: coarse)')
  const maxTools = phone ? 2 : 3

  const bar = useRef<HTMLDivElement>(null)
  const full = useRef<HTMLSpanElement>(null)
  const short = useRef<HTMLSpanElement>(null)
  const [room, setRoom] = useState<number | null>(null)
  const [words, setWords] = useState<{ full: number; short?: number } | null>(null)

  // The room, as the bar's width changes (the pane resized, the window turned).
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const measure = () => setRoom(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The main action's words, as wide as its button would be: again when they change (another language) or the font loads.
  useLayoutEffect(() => {
    const measure = () => {
      if (!full.current) return setWords(null)
      setWords({ full: full.current.offsetWidth, ...(short.current ? { short: short.current.offsetWidth } : {}) })
    }
    measure()
    if (typeof document === 'undefined' || !document.fonts) return
    let live = true
    void document.fonts.ready.then(() => live && measure())
    return () => {
      live = false
    }
  }, [main?.label, main?.short, main?.icon, main?.expanded])

  const layout: BarLayout =
    room === null || (main && !words)
      ? { step: 'full', tools: Math.min(tools.length, maxTools), more: hasMenu || tools.length > maxTools || (coarse && tools.length > 0) }
      : layoutActions({
          room,
          main: main && words ? { full: words.full, short: words.short, icon: main.icon ? ICON : undefined } : null,
          tools: tools.length,
          maxTools,
          menu: hasMenu || (coarse && tools.length > 0),
          toolWidth: ICON,
          moreWidth: ICON,
          gap: GAP,
        })
  const groups = menuGroups(sorted, layout.tools, coarse)

  // The main action's button as drawn, for measuring: an icon, its words, a disclosure's chevron.
  const measureButton = (text: string, ref: RefObject<HTMLSpanElement | null>) => (
    <span ref={ref} className={buttonVariants({ className: 'w-max' })}>
      {main ? <ActionIcon action={main} /> : null}
      {text}
      {main?.expanded !== undefined ? <ChevronDown aria-hidden /> : null}
    </span>
  )

  return (
    <div ref={bar} data-slot="action-bar" className={cn('relative flex min-w-0 items-center gap-2 print:hidden', className)}>
      {main ? (
        <span aria-hidden inert className="pointer-events-none invisible absolute top-0 left-0 flex gap-2 whitespace-nowrap">
          {measureButton(main.label, full)}
          {main.short ? measureButton(main.short, short) : null}
        </span>
      ) : null}
      {main ? <MainButton action={main} step={layout.step} /> : null}
      {tools.slice(0, layout.tools).map((a) => (
        <ToolButton key={a.id} action={a} />
      ))}
      {layout.more && groups.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon" variant="ghost" className="ml-auto shrink-0" />} aria-label={moreLabel}>
            <Ellipsis aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <ActionMenuItems groups={groups} />
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}
