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
 * The current section's link is aria-current="page", or "true" when its
 * screens are listed under it (navSubItem), one of which is the page: it
 * looks current in the bar and rail, and the rail, the sidebar and the
 * phone's More panel highlight the screen.
 */
export const navItem = cn(
  'group relative flex flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors',
  'h-16 focus-visible:ring-2 focus-visible:ring-ring md:h-auto md:rounded-lg md:py-2',
  'xl:flex-row xl:justify-start xl:gap-3 xl:px-3 xl:py-2.5 xl:text-sm',
  'hover:text-foreground aria-[current=page]:text-foreground aria-[current=true]:text-foreground data-[active=true]:text-foreground xl:hover:bg-accent xl:aria-[current=page]:bg-accent',
)
/** The icon's pill is the phone and rail's active marker; the sidebar highlights the whole row. */
export const navIcon = cn(
  'flex h-8 w-full max-w-14 items-center justify-center rounded-full transition-colors xl:h-auto xl:w-auto xl:max-w-none',
  'group-hover:bg-accent/60 group-aria-[current=page]:bg-accent group-aria-[current=true]:bg-accent group-data-[active=true]:bg-accent',
  'xl:group-hover:bg-transparent xl:group-aria-[current=page]:bg-transparent xl:group-aria-[current=true]:bg-transparent',
)
/** A section under More: a full-width row in the phone's panel, a normal item in the rail and sidebar. */
export const moreItem = cn(
  navItem,
  'max-md:h-12 max-md:flex-row max-md:justify-start max-md:gap-3 max-md:rounded-lg max-md:px-3 max-md:text-sm',
  // A section whose screen is the page (aria-current=true) is not filled: the screen listed under it is.
  'max-md:hover:bg-accent max-md:aria-[current=page]:bg-accent',
)
export const moreIcon = cn(
  navIcon,
  'max-md:h-auto max-md:w-auto max-md:group-aria-[current=page]:bg-transparent max-md:group-aria-[current=true]:bg-transparent max-md:group-hover:bg-transparent',
)
/**
 * A section's own screens, listed under it: in the desktop sidebar on a line
 * from the section's icon; in the rail as short centred links under the
 * section's icon, so the rail reaches each screen too.
 */
export const navSubList = cn(
  'ml-5 hidden flex-col gap-0.5 border-l border-border pl-2 md:flex',
  'md:max-xl:ml-0 md:max-xl:border-l-0 md:max-xl:pl-0',
)
/** The same under a section in the phone's More panel, which has the room. */
export const moreSubList = cn(navSubList, 'max-md:ml-[1.375rem] max-md:flex')
export const navSubItem = cn(
  'flex items-center rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors pointer-coarse:min-h-11',
  'hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-accent aria-[current=page]:text-foreground',
  // The rail's: the size of its labels, centred, a long word broken where the language allows (Оборудование).
  'md:max-xl:justify-center md:max-xl:px-1 md:max-xl:py-1.5 md:max-xl:text-center md:max-xl:text-[0.6875rem] md:max-xl:leading-tight md:max-xl:hyphens-auto md:max-xl:[overflow-wrap:anywhere]',
)

/** The app mark, Gavort's emblem; the app's name shows where there is room for it (phone bar, desktop sidebar). */
export function Brand({ name }: { name: string }) {
  return (
    <span className="flex items-center gap-2 font-semibold">
      <GavortEmblem className="size-8 shrink-0 text-brand-mark" />
      <span className="leading-tight md:sr-only xl:not-sr-only">{name}</span>
    </span>
  )
}
