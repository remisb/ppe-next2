import type { AssetKind, HeldAsset } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { EmptyState, ErrorState, Loading } from '@ppe/ui/components/states'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { Plus } from 'lucide-react'
import { useState } from 'react'

import { StatusBadge } from '@/components/asset-controls'
import { type AssetSheet, AssetSheets } from '@/components/asset-sheets'
import type { PickedEmployee } from '@/components/employee-picker'
import { t } from '@/i18n'
import { categoryLabel, documentsText, formatDay, todayIn } from '@/lib/assets'
import { type Route, linkTo } from '@/lib/router'

const link = 'rounded-sm font-mono font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'

/**
 * Given SIM and Equipment on an employee's page (assets brief §1, §18): the
 * assets of one kind they hold, then those they held, each linking to its
 * page; and Give SIM or Give Asset with them already chosen (§6).
 * Workwear stays in Items given: the categories are kept apart on one page,
 * not in separate systems.
 */
export function HeldAssets({
  kind,
  employee,
  timeZone,
  navigate,
  onChanged,
}: {
  kind: AssetKind
  employee: PickedEmployee
  timeZone: string | undefined
  navigate: (to: Route) => void
  /** A card was given: the page's Changes may want reloading. */
  onChanged?: () => void
}) {
  const { client } = useApi()
  const canManage = useSession().can('assets.manage')
  const held = useLoad(() => client.assets.byEmployee(employee.id), [employee.id])
  const [sheet, setSheet] = useState<AssetSheet>(null)
  const [message, setMessage] = useState('')
  const sim = kind === 'SIM'
  const rows = (held.data ?? []).filter((h) => h.asset.kind === kind)
  const heading = `held-${kind.toLowerCase()}`

  return (
    <section aria-labelledby={heading} className="mb-8">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 id={heading} className="text-lg font-semibold">
          {sim ? t.assets.givenSim : t.assets.equipmentSection}
        </h2>
        {canManage ? (
          <Button variant="outline" onClick={() => setSheet({ kind: 'giveTo', employee, assetKind: kind })}>
            <Plus aria-hidden /> {sim ? t.assets.giveSimCard : t.assets.giveAsset}
          </Button>
        ) : null}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{sim ? t.assets.givenSimIntro : t.assets.equipmentIntro}</p>
      <p role="status" className="mb-2 text-sm text-muted-foreground empty:hidden">
        {message}
      </p>
      {held.error ? (
        <ErrorState error={held.error} onRetry={held.reload} />
      ) : !held.data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <EmptyState>{sim ? t.assets.noGivenSim(employee.full_name) : t.assets.noEquipmentGiven(employee.full_name)}</EmptyState>
      ) : (
        <ul className="grid gap-2">
          {rows.map((h) => (
            <HeldRow key={h.id} held={h} navigate={navigate} />
          ))}
        </ul>
      )}
      <AssetSheets
        sheet={sheet}
        today={todayIn(timeZone)}
        onChange={setSheet}
        onDone={(m) => {
          setMessage(m)
          held.reload()
          onChanged?.()
        }}
      />
    </section>
  )
}

function HeldRow({ held: h, navigate }: { held: HeldAsset; navigate: (to: Route) => void }) {
  const open = h.returned_date === null
  return (
    <li className={cn('rounded-lg border border-border px-3 py-2 text-sm', !open && 'text-muted-foreground')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a {...linkTo({ name: 'asset', id: h.asset.id }, navigate)} className={link}>
          {h.asset.inventory_no}
        </a>
        {h.asset.kind === 'SIM' ? (
          <>
            <span className="font-mono">{h.asset.phone_no ?? h.asset.sim_no}</span>
            <span>{h.asset.provider}</span>
          </>
        ) : (
          <>
            <span>{h.asset.name}</span>
            {h.asset.category ? <span className="text-muted-foreground">{categoryLabel(h.asset.category)}</span> : null}
          </>
        )}
        {h.asset.connection_status ? <StatusBadge status={h.asset.connection_status} /> : null}
        {h.not_returned_at && open ? <Badge variant="destructive">{t.assets.notReturned}</Badge> : null}
      </div>
      <div className="text-xs text-muted-foreground">
        {t.assets.givenOnDate(formatDay(h.given_date))} ·{' '}
        {h.returned_date ? t.assets.returnedOnDate(formatDay(h.returned_date)) : t.assets.stillHeld} · {t.assets.daysHeld(h.days_held)}
        {documentsText(h) ? ` · ${documentsText(h)}` : ''}
      </div>
    </li>
  )
}
