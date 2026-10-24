import type { DashboardReplacement } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { EmptyState, Loaded, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, stackedBreak } from '@ppe/ui/components/table'
import { useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { FileText, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { inlineLink } from '@/components/dashboard'
import { RecordPreview } from '@/components/record-preview'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { BackButton } from '@ppe/ui/components/back-button'
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
 * Each row reorders the item for the employee at the quantity given last time.
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
      <BackButton className="mb-2" onClick={onBack}>{t.dashboard.title}</BackButton>
      <PageHeader
        title={t.dashboard.replacementsDue}
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
              <Table stack>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.dashboard.employee}</TableHead>
                    <TableHead>{t.dashboard.item}</TableHead>
                    <TableHead>{t.dashboard.due}</TableHead>
                    <TableHead>{t.dashboard.lastGiven}</TableHead>
                    <TableHead>
                      <span className="sr-only">{t.dashboard.reorder}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="stacked:gap-2">
                  {rows.map((x) => (
                    <Row key={`${x.employee_id}-${x.catalogue_item_id}`} x={x} tz={tz} navigate={navigate} />
                  ))}
                </TableBody>
              </Table>
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

/** One replacement: who, what, when it was due or is due, the receipt it was given on, and Reorder. */
function Row({ x, tz, navigate }: { x: DashboardReplacement; tz: string; navigate: (to: Route) => void }) {
  return (
    <TableRow className={cn(stackedBreak, 'stacked:py-2.5')}>
      <TableCell className="stacked:order-1 stacked:w-auto stacked:flex-1">
        <a {...linkTo({ name: 'employee', id: x.employee_id }, navigate)} className={inlineLink}>
          {x.employee_name}
        </a>
        {x.employee_code ? <span className="text-muted-foreground"> · {x.employee_code}</span> : null}
      </TableCell>
      <TableCell className="whitespace-normal stacked:order-3">
        <span className="font-medium">{x.item_name}</span>
        {x.size ? <span className="text-muted-foreground"> · {formatSize(x.size)}</span> : null}
        <span className="text-muted-foreground tabular-nums"> × {x.quantity}</span>
      </TableCell>
      <TableCell className="tabular-nums stacked:order-1 stacked:w-auto">
        <span className="inline-flex items-center gap-2">
          <RelativeDate iso={x.due_at} timeZone={tz} className="stacked:hidden" />
          <Badge variant={x.overdue ? 'destructive' : 'secondary'}>{x.overdue ? t.dashboard.overdue : t.dashboard.dueSoon}</Badge>
        </span>
      </TableCell>
      <TableCell className="stacked:order-4 stacked:w-auto stacked:text-xs stacked:text-muted-foreground">
        <span className="hidden stacked:inline">
          {t.dashboard.due} <RelativeDate iso={x.due_at} timeZone={tz} sentence /> ·{' '}
        </span>
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
        <span className="text-muted-foreground">
          {t.dashboard.given} <RelativeDate iso={x.given_at} timeZone={tz} sentence />
        </span>
      </TableCell>
      <TableCell className="text-right stacked:order-4 stacked:ml-auto stacked:w-auto">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigate({ name: 'createOrder', prefill: { employeeId: x.employee_id, items: [{ id: x.catalogue_item_id, quantity: x.quantity }] } })
          }
        >
          <RotateCcw aria-hidden /> {t.dashboard.reorder}
          <span className="sr-only"> {t.dashboard.itemFor(x.item_name, x.employee_name)}</span>
        </Button>
      </TableCell>
    </TableRow>
  )
}
