import type { DashboardReplacement } from '@ppe/api-client'
import { ArrowLeft, FileText, RotateCcw } from 'lucide-react'
import { useState } from 'react'

import { formatDate, inlineLink } from '@/components/dashboard'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, stackedBreak } from '@/components/ui/table'
import { useApi } from '@/lib/api'
import { type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { cn, formatSize } from '@/lib/utils'

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
        { value: 'all', label: 'All', count: r.overdue + r.due_soon },
        { value: 'overdue', label: 'Overdue', count: r.overdue },
        { value: 'soon', label: 'Due soon', count: r.due_soon },
      ]
    : []

  return (
    <>
      <Button variant="ghost" className="-ml-3 mb-2" onClick={onBack}>
        <ArrowLeft aria-hidden /> Dashboard
      </Button>
      <PageHeader
        title="Replacements due"
        description={`Items whose service period has ended or ends within ${r?.due_soon_days ?? 30} days, counted from the date given, and not already on an open order. Dates are in ${tz}.`}
      />
      {list.error ? (
        <ErrorState error={list.error} onRetry={list.reload} />
      ) : !r ? (
        <Loading />
      ) : (
        <>
          <div role="group" aria-label="Show" className="mb-4 grid w-full grid-flow-col auto-cols-fr gap-1 rounded-lg bg-muted p-1 sm:inline-grid sm:w-auto">
            {tabs.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={show === t.value}
                onClick={() => setShow(t.value)}
                className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm pointer-coarse:h-11"
              >
                {t.label}
                <span className="tabular-nums text-muted-foreground">{t.count}</span>
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <EmptyState>
              {show === 'overdue' ? 'Nothing is overdue.' : show === 'soon' ? 'Nothing else is due in the next 30 days.' : 'Nothing is due for replacement.'}
            </EmptyState>
          ) : (
            <Table stack>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Last given</TableHead>
                  <TableHead>
                    <span className="sr-only">Reorder</span>
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
            <p className="mt-3 text-xs text-muted-foreground">Showing the {r.next.length} soonest due.</p>
          ) : null}
        </>
      )}
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
          <span className="stacked:hidden">{formatDate(x.due_at, tz)}</span>
          <Badge variant={x.overdue ? 'destructive' : 'secondary'}>{x.overdue ? 'Overdue' : 'Due soon'}</Badge>
        </span>
      </TableCell>
      <TableCell className="stacked:order-4 stacked:w-auto stacked:text-xs stacked:text-muted-foreground">
        <span className="hidden stacked:inline">Due {formatDate(x.due_at, tz)} · </span>
        <a
          {...linkTo({ name: 'record', id: x.order_id }, navigate)}
          aria-label={`Receipt ${x.record_number}`}
          className={cn(inlineLink, 'inline-flex items-center gap-1 font-normal')}
        >
          <FileText aria-hidden className="size-3.5" />
          {x.record_number}
        </a>{' '}
        <span className="text-muted-foreground">given {formatDate(x.given_at, tz)}</span>
      </TableCell>
      <TableCell className="text-right stacked:order-4 stacked:ml-auto stacked:w-auto">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigate({ name: 'createOrder', prefill: { employeeId: x.employee_id, items: [{ id: x.catalogue_item_id, quantity: x.quantity }] } })
          }
        >
          <RotateCcw aria-hidden /> Reorder
          <span className="sr-only">
            {' '}
            {x.item_name} for {x.employee_name}
          </span>
        </Button>
      </TableCell>
    </TableRow>
  )
}
