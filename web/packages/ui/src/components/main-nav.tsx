import { GavortEmblem } from './gavort-logo.tsx'
import { cn } from '../lib/utils.ts'

/*
 * One navigation, three layouts:
 *   phone (< md)   the first four sections are a bottom tab bar within thumb
 *                  reach, above the home bar, with Create Order as a raised
 *                  New order button in the middle; More opens a panel above it
 *                  with the other sections, the account and Sign out
 *   tablet (md)    a 5.5rem side rail: icon over a short label. It stays up to
 *                  xl so a landscape tablet (1024px) keeps room for tables
 *   desktop (xl)   a 15rem sidebar: icon beside the full label
 * The link's accessible name is always the full label, from its (visually
 * hidden) text rather than aria-label, which would also turn up in label
 * lookups such as a field's "Item Set".
 */
export const navItem = cn(
  'group relative flex flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors',
  'h-16 focus-visible:ring-2 focus-visible:ring-ring md:h-auto md:rounded-lg md:py-2',
  'xl:flex-row xl:justify-start xl:gap-3 xl:px-3 xl:py-2.5 xl:text-sm',
  'hover:text-foreground aria-[current=page]:text-foreground data-[active=true]:text-foreground xl:hover:bg-accent xl:aria-[current=page]:bg-accent',
)
/** The icon's pill is the phone and rail's active marker; the sidebar highlights the whole row. */
export const navIcon = cn(
  'flex h-8 w-full max-w-14 items-center justify-center rounded-full transition-colors xl:h-auto xl:w-auto xl:max-w-none',
  'group-hover:bg-accent/60 group-aria-[current=page]:bg-accent group-data-[active=true]:bg-accent xl:group-hover:bg-transparent xl:group-aria-[current=page]:bg-transparent',
)
/** A section under More: a full-width row in the phone's panel, a normal item in the rail and sidebar. */
export const moreItem = cn(
  navItem,
  'max-md:h-12 max-md:flex-row max-md:justify-start max-md:gap-3 max-md:rounded-lg max-md:px-3 max-md:text-sm',
  'max-md:hover:bg-accent max-md:aria-[current=page]:bg-accent',
)
export const moreIcon = cn(navIcon, 'max-md:h-auto max-md:w-auto max-md:group-aria-[current=page]:bg-transparent max-md:group-hover:bg-transparent')

/** The app mark, Gavort's emblem; the app's name shows where there is room for it (phone bar, desktop sidebar). */
export function Brand({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2 font-semibold">
      <GavortEmblem className="size-8 shrink-0 text-brand-mark" />
      <span className="leading-tight md:sr-only xl:not-sr-only">{name}</span>
    </span>
  )
}
