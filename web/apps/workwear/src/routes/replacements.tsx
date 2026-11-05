import type { DashboardReplacement } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { EmptyState, Loaded, PageHeader } from '@ppe/ui/components/states'
import { RuleList } from '@ppe/ui/components/rule-list'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { FileText, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { inlineLink } from '@/components/dashboard'
import { RecordPreview } from '@/components/record-preview'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { Segmented } from '@ppe/ui/components/segmented'
import { t } from '@/i18n'
import { type Route, linkTo } from '@/lib/router'
import { formatSize } from '@/lib/utils'

type Show = 'all' | 'overdue' | 'soon'

/**
 * Replacements due (/replacements): every item whose service period has ended
 * or ends within the next 30 days, for every employee, by the dashboards' rule
 * (the latest given line per employee and item, not already on an open order).
 * The dashboards list the first few; their Replacements due tile opens this.
 * Grouped by employee, each with one Reorder for all of theirs at the quantities given last time.
 */
export function Replacements({ navigate, onBack }: { navigate: (to: Route) => void; onBack: () => void }) {
  const { client } = useApi()
  const list = useLoad(() => client.replacements())
  const settings = useLoad(() => client.settings())
  const [show, setShow] = useState<Show>('all')
  const tz = settings.data?.timezone ?? 'UTC'
  const r = list.data
  const rows = (r?.next ?? []).filter((x) => show === 'all' || (show === 'overdue') === x.overdue)
  const tabs: { value: Show; label: string; count: number }[] = r
    ? [
        { value: 'all', label: t.common.all, count: r.overdue + r.due_soon },
        { value: 'overdue', label: t.dashboard.overdue, count: r.overdue },
        { value: 'soon', label: t.dashboard.dueSoon, count: r.due_soon },
      ]
    : []

  return (
    <>
      <PageHeader
        title={t.dashboard.replacementsDue}
        back={{ label: t.dashboard.title, onClick: onBack }}
        description={t.dashboard.replacementsDescription(r?.due_soon_days ?? 30, tz)}
      />
      <Loaded load={list}>
        {(r) => (
          <>
            <Segmented label={t.dashboard.show} options={tabs} value={show} onChange={setShow} className="mb-4" />
            {rows.length === 0 ? (
              <EmptyState>
                {show === 'overdue'
                  ? t.dashboard.nothingOverdue
                  : show === 'soon'
                    ? t.dashboard.nothingElseDue
                    : t.dashboard.nothingDueForReplacement}
              </EmptyState>
            ) : (
              <RuleList ordered aria-label={t.dashboard.replacementsDue} className="border-y py-3">
                {byEmployee(rows).map((g) => (
                  <Group key={g[0]!.employee_id} items={g} tz={tz} navigate={navigate} />
                ))}
              </RuleList>
            )}
            {r.overdue + r.due_soon > r.next.length ? (
              <p className="mt-3 text-xs text-muted-foreground">{t.dashboard.showingSoonest(r.next.length)}</p>
            ) : null}
          </>
        )}
      </Loaded>
    </>
  )
}

/** The rows of each employee together, in the order of their soonest one (the list comes soonest first). */
function byEmployee(rows: DashboardReplacement[]): DashboardReplacement[][] {
  const groups = new Map<string, DashboardReplacement[]>()
  for (const x of rows) groups.set(x.employee_id, [...(groups.get(x.employee_id) ?? []), x])
  return [...groups.values()]
}

/**
 * One employee's replacements: who, with one Reorder for all of them (S14: one
 * order per person, as the employee page's Reorder all), then each item, when it
 * was due or is due, and the receipt it was given on.
 */
function Group({ items, tz, navigate }: { items: DashboardReplacement[]; tz: string; navigate: (to: Route) => void }) {
  const who = items[0]!
  return (
    <li>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-sm font-semibold">
          <a {...linkTo({ name: 'employee', id: who.employee_id }, navigate)} className={inlineLink}>
            {who.employee_name}
          </a>
          {who.employee_code ? <span className="font-normal text-muted-foreground"> · {who.employee_code}</span> : null}
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigate({
              name: 'createOrder',
              prefill: { employeeId: who.employee_id, items: items.map((x) => ({ id: x.catalogue_item_id, quantity: x.quantity })) },
            })
          }
        >
          <RotateCcw aria-hidden /> {items.length === 1 ? t.dashboard.reorder : t.employees.reorderAll(items.length)}
          <span className="sr-only">{items.length === 1 ? t.dashboard.itemFor(who.item_name, who.employee_name) : t.dashboard.forName(who.employee_name)}</span>
        </Button>
      </div>
      <ul className="mt-2 grid gap-2">
        {items.map((x) => (
          <li key={x.catalogue_item_id} className="text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                <span className="font-medium">{x.item_name}</span>
                {x.size ? <span className="text-muted-foreground"> · {formatSize(x.size)}</span> : null}
                <span className="text-muted-foreground tabular-nums"> × {x.quantity}</span>
              </span>
              <Badge variant={x.overdue ? 'destructive' : 'secondary'}>{x.overdue ? t.dashboard.overdue : t.dashboard.dueSoon}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              {t.dashboard.due} <RelativeDate iso={x.due_at} timeZone={tz} sentence /> ·{' '}
              <RecordPreview
                orderId={x.order_id}
                timeZone={tz}
                {...linkTo({ name: 'record', id: x.order_id }, navigate)}
                aria-label={t.dashboard.receipt(x.record_number)}
                className={cn(inlineLink, 'inline-flex items-center gap-1 font-normal')}
              >
                <FileText aria-hidden className="size-3.5" />
                {x.record_number}
              </RecordPreview>{' '}
              {t.dashboard.given} <RelativeDate iso={x.given_at} timeZone={tz} sentence />
            </div>
          </li>
        ))}
      </ul>
    </li>
  )
}
