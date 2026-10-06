import type { CatalogueIcon } from '@ppe/api-client'
import { cn } from '@ppe/ui/lib/utils'
import { Glasses, Hand, HardHat, Headphones, type LucideProps, Package, Shirt } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

import { t } from '@/i18n'

/*
 * Pictograms for catalogue items, so an item is recognised by its picture as
 * well as its name: in Add Item, the catalogue and order lines. Lucide draws
 * most; the six it lacks (a work boot, trousers, a hi-vis vest, a
 * respirator, a welding helmet, a quilted insulated jacket) are drawn here in
 * the same 24px, 2px-stroke style.
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

/** A welding helmet from the front: the shell, its dark viewing window and the side pivots. */
function WeldingHelmet(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M5 9a7 6 0 0 1 14 0v6a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6z" />
      <rect x="8" y="10" width="8" height="4" rx="1" fill="currentColor" />
      <path d="M3 11h2M19 11h2" />
    </Svg>
  )
}

/** A quilted jacket with long sleeves: the zip and bands of padding tell it from a work jacket. */
function InsulatedJacket(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M9 3 4 5 2 18h4l1-7v10h10V11l1 7h4L20 5l-5-2a3 3 0 0 1-6 0z" />
      <path d="M12 6v15" />
      <path d="M7 11h10M7 16h10" />
    </Svg>
  )
}

type IconComponent = ComponentType<LucideProps> | ComponentType<SVGProps<SVGSVGElement>>

const drawings: Record<CatalogueIcon, IconComponent> = {
  shoes: Boot,
  jacket: Shirt,
  insulated_jacket: InsulatedJacket,
  trousers: Trousers,
  vest: Vest,
  gloves: Hand,
  helmet: HardHat,
  welding_helmet: WeldingHelmet,
  glasses: Glasses,
  ear: Headphones,
  mask: Respirator,
  other: Package,
}

/** The pictograms in the order the item form offers them. */
const iconOrder: CatalogueIcon[] = ['shoes', 'jacket', 'insulated_jacket', 'trousers', 'vest', 'gloves', 'helmet', 'welding_helmet', 'glasses', 'ear', 'mask', 'other']

/** The pictograms in the order the item form offers them, with their names in the current language. */
export function iconChoices(): { icon: CatalogueIcon; label: string }[] {
  return iconOrder.map((icon) => ({ icon, label: t.catalogue.icons[icon] }))
}

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
