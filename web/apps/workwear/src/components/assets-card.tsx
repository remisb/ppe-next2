import { useApi } from '@ppe/app-shell'
import { Panel } from '@ppe/ui/components/panel'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowRight } from 'lucide-react'

import { t } from '@/i18n'
import { type AssetTile, type Route, linkTo } from '@/lib/router'

/**
 * Company Assets on a dashboard: the SIM card register's figures, each
 * opening the register on its tile. The register is under More on a phone,
 * so this is the way there from Home in one tap (UX review, placement P2).
 * It loads on its own: the dashboard never waits for it, and a failure to
 * load leaves it out.
 */
export function AssetsCard({ navigate, className }: { navigate: (to: Route) => void; className?: string }) {
  const { client } = useApi()
  const summary = useLoad(() => client.assets.summary('SIM'))
  const s = summary.data
  if (!s) return null
  const rows: { label: string; value: number; tile?: AssetTile; alert?: boolean }[] = [
    { label: t.assets.totalSimCards, value: s.total },
    { label: t.assets.inOffice, value: s.in_office, tile: 'inOffice' },
    { label: t.assets.withEmployees, value: s.with_employees, tile: 'withEmployees' },
    { label: t.assets.notReturned, value: s.not_returned, tile: 'notReturned', alert: s.not_returned > 0 },
  ]
  return (
    <Panel title={t.assets.title} description={t.assets.tilesOverlap} className={className}>
      <ul className="-mx-2 flex flex-col">
        {rows.map((r) => (
          <li key={r.label}>
            <a
              {...linkTo({ name: 'assets', ...(r.tile ? { tile: r.tile } : {}) }, navigate)}
              className="flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">{r.label}</span>
              <span className={cn('font-semibold tabular-nums', r.alert && 'text-destructive')}>{r.value}</span>
              <ArrowRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            </a>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
