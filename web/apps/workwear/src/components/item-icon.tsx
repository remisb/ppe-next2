import type { CatalogueIcon } from '@ppe/api-client'
import { Glasses, Hand, HardHat, Headphones, type LucideProps, Package, Shirt } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

import { cn } from '@/lib/utils'

/*
 * Pictograms for catalogue items, so an item is recognised by its picture as
 * well as its name: in Add Item, the catalogue and order lines. Lucide draws
 * most; the four it lacks (a work boot, trousers, a hi-vis vest, a
 * respirator) are drawn here in the same 24px, 2px-stroke style.
 */

function Svg({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

function Boot(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 3h6v8l6 3a3 3 0 0 1 3 3v2H3V5a2 2 0 0 1 2-2z" />
      <path d="M3 19v2h18v-2" />
      <path d="M12 7H9" />
    </Svg>
  )
}

function Trousers(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 3h12l1 18h-5l-2-11-2 11H5z" />
      <path d="M6 7h12" />
    </Svg>
  )
}

function Vest(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8 3 4 6v15h6v-9l2-3 2 3v9h6V6l-4-3-4 5z" />
      <path d="M4 15h6M14 15h6" />
    </Svg>
  )
}

function Respirator(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M5 9c0-2 2.5-4 7-4s7 2 7 4v3a7 7 0 0 1-14 0z" />
      <path d="M5 10 2 8M19 10l3-2" />
      <circle cx="9" cy="13" r="1.5" />
      <circle cx="15" cy="13" r="1.5" />
    </Svg>
  )
}

type IconComponent = ComponentType<LucideProps> | ComponentType<SVGProps<SVGSVGElement>>

const drawings: Record<CatalogueIcon, IconComponent> = {
  shoes: Boot,
  jacket: Shirt,
  trousers: Trousers,
  vest: Vest,
  gloves: Hand,
  helmet: HardHat,
  glasses: Glasses,
  ear: Headphones,
  mask: Respirator,
  other: Package,
}

/** The pictograms in the order the item form offers them, with their names. */
export const iconChoices: { icon: CatalogueIcon; label: string }[] = [
  { icon: 'shoes', label: 'Shoes' },
  { icon: 'jacket', label: 'Jacket' },
  { icon: 'trousers', label: 'Trousers' },
  { icon: 'vest', label: 'Vest' },
  { icon: 'gloves', label: 'Gloves' },
  { icon: 'helmet', label: 'Helmet' },
  { icon: 'glasses', label: 'Glasses' },
  { icon: 'ear', label: 'Ear protection' },
  { icon: 'mask', label: 'Mask' },
  { icon: 'other', label: 'Other' },
]

/** An item's pictogram, decorative: the item's name always stands beside it. */
export function ItemIcon({ icon, className }: { icon: CatalogueIcon | undefined; className?: string }) {
  const Drawing = drawings[icon ?? 'other'] ?? Package
  return <Drawing aria-hidden className={cn('size-4 shrink-0', className)} />
}

/** The pictogram on a soft tile, for lists: a fixed size so names line up. */
export function ItemTile({ icon, className }: { icon: CatalogueIcon | undefined; className?: string }) {
  return (
    <span aria-hidden className={cn('flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground', className)}>
      <ItemIcon icon={icon} className="size-5" />
    </span>
  )
}
