import { ArrowLeft, ChevronDown, Ellipsis, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, type MouseEventHandler, type ReactNode } from 'react'

import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'
import { Button, buttonVariants } from './button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './dropdown-menu.tsx'
import { InfoTip } from './info-tip.tsx'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip.tsx'

/** The widths a toolbar control can start being a button from (Tailwind's sm, md, lg). */
export type ToolbarWidth = 'sm' | 'md' | 'lg'

/**
 * A toolbar control that is a button, or an item in ⋯ where the row is too
 * narrow for it (showFrom). A link (`link`, from linkTo) opens in a new tab too.
 */
export interface ToolbarAction {
  label: string
  /** Shorter words below sm, where the title needs the room: "Add". */
  short?: string | undefined
  icon?: LucideIcon | undefined
  onClick?: (() => void) | undefined
  link?: { href: string; onClick?: MouseEventHandler<HTMLAnchorElement> } | undefined
  disabled?: boolean | undefined
  /**
   * From which width it is a button; below it, an item in ⋯ instead. 'always'
   * never moves; 'never' is always in ⋯.
   */
  showFrom?: 'always' | ToolbarWidth | 'never' | undefined
  /** Not shown at all below this width (Create Order on a phone's Orders, which the tab bar has). */
  hiddenBelow?: ToolbarWidth | undefined
}

// Whole class names, so Tailwind finds them.
const buttonFrom = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden' } as const
const itemFrom = { sm: 'sm:hidden', md: 'md:hidden', lg: 'lg:hidden' } as const
const widthOrder: ToolbarWidth[] = ['sm', 'md', 'lg']

/** The ⋯ menu's classes: shown only at the widths where it holds something. */
export function moreShownBelow(actions: readonly ToolbarAction[], always: boolean): 'always' | ToolbarWidth | null {
  if (always || actions.some((a) => a.showFrom === 'never')) return 'always'
  const from = actions.map((a) => a.showFrom).filter((w): w is ToolbarWidth => w === 'sm' || w === 'md' || w === 'lg')
  if (from.length === 0) return null
  return widthOrder[Math.max(...from.map((w) => widthOrder.indexOf(w)))] ?? null
}

/** The overflow's place in ⋯: in the toolbar's order, which is the order given. */
export function overflowItems(actions: readonly ToolbarAction[]): ToolbarAction[] {
  return actions.filter((a) => a.showFrom !== undefined && a.showFrom !== 'always')
}

/**
 * A button's words with shorter ones below sm, where a header's title needs
 * the room: "Create link" for Create confirmation link. The full words stay
 * its name for a screen reader.
 */
export function ShortWords({ label, short }: { label: string; short?: string | undefined }) {
  if (!short) return label
  return (
    <>
      <span className="max-sm:sr-only">{label}</span>
      <span aria-hidden className="sm:hidden">
        {short}
      </span>
    </>
  )
}

function ActionButton({ action, variant }: { action: ToolbarAction; variant: 'default' | 'outline' }) {
  const Icon = action.icon
  const from = action.showFrom === 'sm' || action.showFrom === 'md' || action.showFrom === 'lg' ? buttonFrom[action.showFrom] : undefined
  const className = cn(from, action.hiddenBelow && buttonFrom[action.hiddenBelow])
  const content = (
    <>
      {Icon ? <Icon aria-hidden /> : null}
      <ShortWords label={action.label} short={action.short} />
    </>
  )
  if (action.link) {
    return (
      <a
        href={action.link.href}
        onClick={action.link.onClick}
        className={buttonVariants({ variant, className })}
      >
        {content}
      </a>
    )
  }
  return (
    <Button variant={variant} className={className} disabled={action.disabled} onClick={action.onClick}>
      {content}
    </Button>
  )
}

function ActionItem({ action }: { action: ToolbarAction }) {
  const Icon = action.icon
  const from = action.showFrom === 'sm' || action.showFrom === 'md' || action.showFrom === 'lg' ? itemFrom[action.showFrom] : undefined
  const inner = (
    <>
      {Icon ? <Icon aria-hidden /> : null}
      {action.label}
    </>
  )
  if (action.link) {
    return (
      <DropdownMenuItem className={from} disabled={action.disabled} render={<a href={action.link.href} onClick={action.link.onClick} />}>
        {inner}
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenuItem className={from} disabled={action.disabled} onClick={action.onClick}>
      {inner}
    </DropdownMenuItem>
  )
}

/**
 * A phone's Filters: shows the filters folded under the search, with how many
 * are set. Pressed in a stuck header, it also scrolls them back under it
 * (the region, or the filter bar around it: data-slot="filter-bar").
 */
export interface ToolbarFilters {
  /** "Filters" */
  label: string
  /** How many of the folded filters are set. */
  count: number
  /** The id of what it opens. */
  controls: string
  open: boolean
  onToggle: () => void
}

function FiltersButton({ filters }: { filters: ToolbarFilters }) {
  const opening = useRef(false)
  useEffect(() => {
    if (!filters.open || !opening.current) return
    opening.current = false
    const region = document.getElementById(filters.controls)
    // The region is under the search; bring the whole filter bar into view when it has scrolled away.
    const bar = region?.closest<HTMLElement>('[data-slot=filter-bar]') ?? region
    if (!region || !bar) return
    const top = bar.getBoundingClientRect().top
    const offset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('scroll-padding-top')) || 0
    // No focus moved: on a phone a focused search would open the keyboard over what was asked for.
    if (top < offset) bar.scrollIntoView({ block: 'start' })
  }, [filters.open, filters.controls])
  const words = filters.count > 0 ? `${filters.label} (${filters.count})` : filters.label
  return (
    <Button
      variant="outline"
      className="md:hidden max-sm:px-3"
      aria-expanded={filters.open}
      aria-controls={filters.controls}
      aria-label={words}
      onClick={() => {
        opening.current = !filters.open
        filters.onToggle()
      }}
    >
      <SlidersHorizontal aria-hidden />
      {/* Below sm the count alone, so the title keeps the room. */}
      <span aria-hidden className="max-sm:hidden">{filters.label}</span>
      {filters.count > 0 ? <span aria-hidden className="tabular-nums"><span className="max-sm:hidden">(</span>{filters.count}<span className="max-sm:hidden">)</span></span> : null}
    </Button>
  )
}

/**
 * A menu button: a labelled button with a chevron, for a menu of one kind of
 * choice (Dashboards, Guide language, Sort). Its items are DropdownMenu items,
 * usually a radio group with the current choice ticked.
 */
export function MenuButton({
  label,
  icon: Icon,
  className,
  children,
  'aria-label': ariaLabel,
}: {
  /** What the button says: the current choice, or the menu's name. */
  label: ReactNode
  icon?: LucideIcon | undefined
  className?: string | undefined
  children: ReactNode
  'aria-label'?: string | undefined
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" className={cn('max-w-full', className)} />} aria-label={ariaLabel}>
        {Icon ? <Icon aria-hidden /> : null}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown aria-hidden className="-mr-1 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A screen's header (ui-language.md, "Page header"): one row, the title with
 * its ⓘ and the toolbar, that stays at the top of the screen while it
 * scrolls. On a phone it slides over the bar with the app's name. The
 * toolbar's controls are in a fixed order, whatever order they are passed in:
 * Filters (a phone's), Refresh, up to two secondary buttons, a menu button,
 * the primary, then ⋯. A secondary or primary with showFrom moves into ⋯
 * below that width; `more` holds the screen's rare actions, which are never
 * buttons, and `moreAsk` what asks first or empties work ("Clear order…"),
 * last. ⋯ shows only where it holds something.
 *
 * description explains the screen without taking room: an ⓘ beside the
 * title. subtitle is a line under the row that scrolls away, for a fact such
 * as who is signed in. `back` puts the way back to where the screen was
 * opened from at the start of the row, an arrow named "Back to Dashboard", as
 * a record's row has it: nothing goes above the header, which takes main's
 * top padding.
 */
export function PageHeader({
  title,
  description,
  subtitle,
  icon,
  back,
  filters,
  refresh,
  secondary = [],
  menu,
  primary,
  more,
  moreAsk,
}: {
  title: string
  description?: string | undefined
  subtitle?: ReactNode
  /** A decorative mark before the title, such as an item's pictogram. */
  icon?: ReactNode
  /** Where the screen was opened from: "Dashboard". */
  back?: { label: string; onClick: () => void } | undefined
  filters?: ToolbarFilters | undefined
  /** A RefreshButton, on screens of live figures. */
  refresh?: ReactNode
  secondary?: readonly ToolbarAction[]
  /** A MenuButton. */
  menu?: ReactNode
  primary?: ToolbarAction | undefined
  /** DropdownMenuItems for the screen's rare actions. */
  more?: ReactNode
  /** DropdownMenuItems that ask first, their labels ending in "…". */
  moreAsk?: ReactNode
}) {
  const mark = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  // Stuck once the mark above the row has scrolled out of sight: an observer, not a scroll listener.
  useEffect(() => {
    const el = mark.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => {
      bar.current?.toggleAttribute('data-stuck', e !== undefined && !e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0))
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const actions = [...secondary, ...(primary ? [primary] : [])]
  const overflow = overflowItems(actions)
  const shownBelow = moreShownBelow(actions, Boolean(more) || Boolean(moreAsk))
  const moreClass = shownBelow === 'always' || shownBelow === null ? undefined : itemFrom[shownBelow]
  const overflowBelow = moreShownBelow(overflow, false)
  const hasToolbar = filters || refresh || actions.length > 0 || menu || shownBelow

  return (
    <>
      {/*
        From md, where nothing is above it, it takes all of main's top padding (-mt-8): at the top of the
        window at rest as when stuck, so its words never move as the screen starts to scroll. On a phone it
        sits under the bar with the app's name and slides over it.
      */}
      <div ref={mark} aria-hidden className="-mt-3 h-px md:-mt-8 print:hidden" />
      <div
        ref={bar}
        data-slot="page-header"
        className={cn(
          // Full width of main, its padding included, so the rule and the shadow reach the edges.
          '-mx-4 -mt-px flex h-(--page-header) items-center gap-3 px-4 md:-mx-6 md:px-6',
          // Opaque: rows seen through it, blurred, read as smudges.
          'sticky top-[env(safe-area-inset-top)] z-40 bg-background md:z-20',
          'border-b border-transparent transition-[border-color,box-shadow] data-stuck:border-border data-stuck:shadow-sm',
          // A short window keeps its height for the content (WCAG 1.4.10); print shows only the title.
          '[@media(height<30rem)]:static print:static print:mx-0 print:h-auto print:px-0',
          subtitle ? 'mb-0' : 'mb-3 md:mb-4',
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {back ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button variant="ghost" size="icon" className="-ml-2.5 shrink-0 print:hidden" aria-label={uiText().backTo(back.label)} onClick={back.onClick}>
                    <ArrowLeft aria-hidden />
                  </Button>
                }
              />
              <TooltipContent aria-hidden>{uiText().backTo(back.label)}</TooltipContent>
            </Tooltip>
          ) : null}
          <h1 className="flex min-w-0 items-center gap-3 text-xl font-semibold tracking-tight md:text-2xl">
            {icon}
            <span className="truncate">{title}</span>
          </h1>
          {description ? <InfoTip section={title}>{description}</InfoTip> : null}
        </div>
        {hasToolbar ? (
          <div className="flex shrink-0 items-center gap-2 print:hidden">
            {filters ? <FiltersButton filters={filters} /> : null}
            {refresh}
            {secondary.map((a) => (
              <ActionButton key={a.label} action={a} variant="outline" />
            ))}
            {menu}
            {primary ? <ActionButton action={primary} variant="default" /> : null}
            {shownBelow ? (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button size="icon" variant="ghost" className={moreClass} />} aria-label={uiText().moreActions(title)}>
                  <Ellipsis aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {overflow.map((a) => (
                    <ActionItem key={a.label} action={a} />
                  ))}
                  {more ? (
                    <>
                      {overflow.length > 0 ? (
                        <DropdownMenuSeparator className={overflowBelow && overflowBelow !== 'always' ? itemFrom[overflowBelow] : undefined} />
                      ) : null}
                      {more}
                    </>
                  ) : null}
                  {moreAsk ? (
                    <>
                      {overflow.length > 0 || more ? (
                        <DropdownMenuSeparator className={!more && overflowBelow && overflowBelow !== 'always' ? itemFrom[overflowBelow] : undefined} />
                      ) : null}
                      {moreAsk}
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        ) : null}
      </div>
      {subtitle ? <p className="-mt-1 mb-5 max-w-prose text-sm text-muted-foreground md:mb-6">{subtitle}</p> : null}
    </>
  )
}
