import { type ComponentProps, type ReactNode, createContext, useContext } from 'react'
import { cn } from '../lib/utils.ts'

type Layout = 'grid' | 'rows'

const LayoutContext = createContext<Layout>('grid')

const layouts: Record<Layout, string> = {
  /** A detail pane's facts: label over value, 2 columns, 3 from the pane's @lg. */
  grid: 'grid grid-cols-2 gap-x-6 gap-y-3 text-sm @lg:grid-cols-3',
  /** A panel's facts: one per line, label left and value right, a rule between. */
  rows: 'divide-y divide-border text-sm',
}

/**
 * A record's current values as label/value pairs (guidelines, "Facts"). `ruled`
 * draws the rules above and below that set a pane's facts apart; the grid has
 * them unless told otherwise.
 */
export function FactGrid({
  layout = 'grid',
  ruled = layout === 'grid',
  className,
  ...props
}: ComponentProps<'dl'> & { layout?: Layout; ruled?: boolean }) {
  return (
    <LayoutContext value={layout}>
      <dl className={cn(layouts[layout], ruled && 'border-y border-border py-3', className)} {...props} />
    </LayoutContext>
  )
}

/** One fact. `wide` gives it the grid's whole row, as a comment needs. */
export function Fact({ label, wide = false, className, children }: { label: string; wide?: boolean; className?: string | undefined; children: ReactNode }) {
  if (useContext(LayoutContext) === 'rows') {
    return (
      <div className={cn('flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2', className)}>
        <dt className="text-muted-foreground">{label}</dt>
        <dd className="min-w-0 text-right break-words tabular-nums">{children}</dd>
      </div>
    )
  }
  return (
    <div className={cn('min-w-0', wide && 'col-span-full', className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium break-words tabular-nums">{children}</dd>
    </div>
  )
}
