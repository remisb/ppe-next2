import type { Employee } from '@ppe/api-client'
import { ArrowLeft, FileText, Plus, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'

import { formatDate } from '@/components/dashboard'
import { EmployeeForm } from '@/components/employee-form'
import { MoreActions } from '@/components/more-actions'
import { RecordPreview } from '@/components/record-preview'
import { RelativeDate } from '@/components/relative-date'
import { SortControl, SortableHead } from '@/components/sortable'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/i18n'
import { useApi, useSession } from '@/lib/api'
import { type Due, type EmployeeItem, employeeItems, loadEmployeeOrders, replacementsDue } from '@/lib/employee-items'
import { formatUsage } from '@/lib/history'
import { missingSizes } from '@/lib/missing-sizes'
import { type Route, linkTo } from '@/lib/router'
import { type SortColumn, type SortState, sizeRank, sortRows } from '@/lib/sort'
import { useLoad } from '@/lib/use-load'
import { clothingBands, clothingSizeLabel, cn, formatMonths, formatSize } from '@/lib/utils'

import { EditSizes, MissingBadge } from './employees'

/**
 * One employee (/employees/<id>): details and size defaults, the items given
 * to them with a link to each receipt and when each is due for replacement,
 * and items ordered but not yet given. Items come from order snapshots, so
 * they show what was actually issued. New order and Reorder start Create
 * Order for them; Edit details and Delete are under ⋯.
 */
export function EmployeePage({ id, navigate, onBack }: { id: string; navigate: (to: Route) => void; onBack: () => void }) {
  const { client } = useApi()
  const session = useSession()
  const employee = useLoad(() => client.employees.get(id), [id])
  const orders = useLoad(() => loadEmployeeOrders(client, id), [id])
  const settings = useLoad(() => client.settings())
  const sizes = useLoad(() => client.sizes())
  const [editing, setEditing] = useState(false)
  const [sizing, setSizing] = useState(false)
  const [actionError, setActionError] = useState<unknown>()

  const items = useMemo(() => employeeItems(orders.data ?? []), [orders.data])
  const due = useMemo(() => replacementsDue(orders.data ?? [], new Date()), [orders.data])
  // What a Reorder would order: due within 30 days (or overdue) and not on an order already.
  const reorder = due.filter((d) => d.dueSoon && !d.reordered)
  const dueByLine = useMemo(() => new Map(due.map((d) => [d.item.key, d])), [due])
  const tz = settings.data?.timezone
  const e = employee.data
  const missing = e ? missingSizes(e) : { clothing: false, shoes: false }

  // Delete is here and under ⋯ in the table, never on a list row a phone scrolls past.
  const remove = async (emp: Employee) => {
    if (!window.confirm(t.employees.confirmDelete(emp.full_name))) return
    setActionError(undefined)
    try {
      await client.employees.remove(emp.id)
      navigate({ name: 'employees' })
    } catch (err) {
      setActionError(err)
    }
  }

  return (
    <>
      <Button variant="ghost" className="-ml-3 mb-2" onClick={onBack}>
        <ArrowLeft aria-hidden /> {t.employees.title}
      </Button>
      {employee.error ? (
        <ErrorState error={employee.error} onRetry={employee.reload} />
      ) : !e ? (
        <Loading />
      ) : (
        <>
          <PageHeader
            title={e.full_name}
            {...(e.code ? { description: t.employees.codeIs(e.code) } : {})}
            actions={
              <>
                <Button onClick={() => navigate({ name: 'createOrder', prefill: { employeeId: e.id, items: [] } })}>
                  <Plus aria-hidden /> {t.employees.newOrder}
                </Button>
                <Button variant="outline" onClick={() => setSizing(true)}>
                  {t.employees.editSizes}
                </Button>
                <MoreActions label={t.common.moreActions(e.full_name)}>
                  <DropdownMenuItem onClick={() => setEditing(true)}>{t.employees.editDetails}</DropdownMenuItem>
                  {session.canManageItems ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => void remove(e)}>
                        {t.employees.deleteEmployee}
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </MoreActions>
              </>
            }
          />
          <dl className="mb-8 grid grid-cols-3 gap-4 rounded-lg border border-border p-4 text-sm sm:max-w-lg">
            <Fact label={t.employees.height}>{e.height_cm ? t.employees.heightCm(e.height_cm) : '—'}</Fact>
            <Fact label={t.employees.clothing}>{missing.clothing ? <MissingBadge /> : clothingSizeLabel(clothingBands(sizes.data?.clothing ?? []), e.clothing_size)}</Fact>
            <Fact label={t.employees.shoes}>{missing.shoes ? <MissingBadge /> : formatSize(e.shoe_size)}</Fact>
            {e.notes ? (
              <div className="col-span-3">
                <dt className="text-muted-foreground">{t.employees.notes}</dt>
                <dd className="mt-0.5 whitespace-pre-line">{e.notes}</dd>
              </div>
            ) : null}
          </dl>

          {reorder.length > 0 ? (
            <Alert className="mb-6">
              <RotateCcw aria-hidden />
              <AlertTitle>{t.employees.dueForReplacement(reorder.length)}</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {reorder
                    .map((d) =>
                      d.overdue ? t.employees.dueItemOverdue(d.item.itemName) : t.employees.dueItemOn(d.item.itemName, formatDate(d.dueAt.toISOString(), tz ?? 'UTC')),
                    )
                    .join(', ')}
                </span>
                <Button
                  size="sm"
                  onClick={() =>
                    navigate({
                      name: 'createOrder',
                      prefill: { employeeId: e.id, items: reorder.map((d) => ({ id: d.item.catalogueItemId, quantity: d.item.quantity })) },
                    })
                  }
                >
                  {reorder.length === 1 ? t.employees.reorderIt : t.employees.reorderAll(reorder.length)}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {actionError ? <ErrorState title={t.common.actionFailed} error={actionError} /> : null}

          <section aria-labelledby="items-given" className="mb-8">
            <h2 id="items-given" className="mb-1 text-lg font-semibold">
              {t.employees.itemsGiven}
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              {t.employees.itemsGivenHint}
              {tz ? ` ${t.employees.datesIn(tz)}` : ''}
            </p>
            {orders.error ? (
              <ErrorState error={orders.error} onRetry={orders.reload} />
            ) : !orders.data ? (
              <Loading />
            ) : items.given.length === 0 ? (
              <EmptyState>{t.employees.noItemsGiven(e.first_name)}</EmptyState>
            ) : (
              <ItemsTable items={items.given} kind="given" tz={tz} due={dueByLine} navigate={navigate} />
            )}
          </section>

          {items.ordered.length > 0 ? (
            <section aria-labelledby="items-ordered" className="mb-8">
              <h2 id="items-ordered" className="mb-1 text-lg font-semibold">
                {t.employees.orderedNotGiven}
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">{t.employees.waitingForReceipt}</p>
              <ItemsTable items={items.ordered} kind="ordered" tz={tz} navigate={navigate} />
            </section>
          ) : null}

          <EmployeeForm
            open={editing}
            employee={e}
            sizes={sizes.data}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false)
              employee.reload()
            }}
          />
          <EditSizes
            employee={sizing ? e : null}
            sizes={sizes.data}
            onClose={() => setSizing(false)}
            onSaved={() => {
              setSizing(false)
              employee.reload()
            }}
          />
        </>
      )}
    </>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  )
}

type ItemSort = 'item' | 'size' | 'quantity' | 'date' | 'usage' | 'period' | 'due' | 'record'

/**
 * Given items link to their receipt (View Record). An ORDERED order has no
 * receipt yet (manual §6), so its record number is plain text. Each table
 * sorts on its own; with no sort it keeps newest activity first.
 */
function ItemsTable({
  items,
  kind,
  tz,
  due,
  navigate,
}: {
  items: EmployeeItem[]
  /** Items given to the employee, or still on order. */
  kind: 'given' | 'ordered'
  tz: string | undefined
  /** For given items: when each item's latest line is due for replacement. Older lines are replaced. */
  due?: Map<string, Due>
  navigate: (to: Route) => void
}) {
  const given = kind === 'given'
  const dateLabel = given ? t.common.given : t.common.ordered
  const [sort, setSort] = useState<SortState<ItemSort> | null>(null)
  const sortProps = { sort, onSort: setSort, allowNone: true }
  const columns: SortColumn<ItemSort>[] = [
    { key: 'item', label: t.employees.item },
    { key: 'size', label: t.employees.size },
    { key: 'quantity', label: t.employees.quantity },
    { key: 'date', label: dateLabel, firstDir: 'desc' },
    ...(given ? [{ key: 'usage' as const, label: t.employees.usageTime }] : []),
    { key: 'period', label: t.employees.servicePeriod },
    ...(due ? [{ key: 'due' as const, label: t.employees.replacement }] : []),
    { key: 'record', label: given ? t.employees.receipt : t.employees.record },
  ]
  const shown = useMemo(
    () =>
      sortRows(items, sort, (i, key) => {
        switch (key) {
          case 'item':
            return i.itemName
          case 'size':
            return sizeRank(i.sizeGroup, i.size)
          case 'quantity':
            return i.quantity
          case 'date':
            return i.at
          case 'usage':
            return i.usageMonths
          case 'period':
            return i.servicePeriodMonths
          case 'due':
            return due?.get(i.key)?.dueAt.toISOString() ?? null
          case 'record':
            return i.recordNumber
        }
      }),
    [items, sort, due],
  )
  return (
    <Table stack stackBelow="lg" sortControl={<SortControl columns={columns} noneLabel={t.employees.newestFirst} {...sortProps} />}>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <SortableHead key={c.key} column={c} align={c.key === 'quantity' ? 'right' : 'left'} {...sortProps} />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {shown.map((i) => (
          <TableRow key={i.key}>
            <TableCell className="min-w-40 whitespace-normal stacked:order-1 stacked:mb-1">
              <span className="font-medium">{i.itemName}</span>
              {i.itemDetails ? <span className="block text-xs text-muted-foreground">{i.itemDetails}</span> : null}
            </TableCell>
            <TableCell label={t.employees.size} className="stacked:order-2">{i.size ?? '–'}</TableCell>
            <TableCell label={t.employees.quantity} className="text-right tabular-nums stacked:order-2">{i.quantity}</TableCell>
            <TableCell label={dateLabel} className="tabular-nums stacked:order-2">
              <RelativeDate iso={i.at} timeZone={tz} time />
            </TableCell>
            {given ? (
              <TableCell label={t.employees.usageTime} className="stacked:order-2">{formatUsage(i.usageMonths) || '—'}</TableCell>
            ) : null}
            <TableCell label={t.employees.servicePeriod} className="stacked:order-2">{formatMonths(i.servicePeriodMonths)}</TableCell>
            {due ? (
              <TableCell label={t.employees.replacement} className="stacked:order-2">
                <DueCell due={due.get(i.key)} tz={tz} />
              </TableCell>
            ) : null}
            <TableCell label={given ? t.employees.receipt : t.employees.record} className="stacked:order-3">
              {/* A given order opens its receipt, one on order its page in History; either previews on hover. */}
              {given ? (
                <RecordPreview
                  orderId={i.orderId}
                  timeZone={tz}
                  {...linkTo({ name: 'record', id: i.orderId }, navigate)}
                  aria-label={t.employees.receiptNumber(i.recordNumber)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                >
                  <FileText aria-hidden className="size-4" />
                  {i.recordNumber}
                </RecordPreview>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <RecordPreview
                    orderId={i.orderId}
                    timeZone={tz}
                    {...linkTo({ name: 'history', order: i.orderId }, navigate)}
                    className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                  >
                    {i.recordNumber}
                  </RecordPreview>
                  <Badge variant="secondary">{t.common.ordered}</Badge>
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/**
 * When the item is due for replacement, with a bar of how much of its service
 * period has passed. An older line of an item given again since is replaced;
 * one already on an order is reordered.
 */
function DueCell({ due, tz }: { due: Due | undefined; tz: string | undefined }) {
  if (!due) return <span className="text-muted-foreground">{t.employees.replaced}</span>
  if (due.reordered) return <Badge variant="secondary">{t.employees.reordered}</Badge>
  const date = formatDate(due.dueAt.toISOString(), tz ?? 'UTC')
  return (
    <span className="flex min-w-36 flex-col items-start gap-1 stacked:items-end">
      <span className={cn('tabular-nums', due.overdue ? 'font-medium text-destructive' : due.dueSoon && 'font-medium')}>
        {due.overdue ? t.employees.overdueSince(date) : t.employees.dueOn(date)}
      </span>
      <span aria-hidden className="block h-1.5 w-32 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full rounded-full', due.overdue ? 'bg-destructive' : due.dueSoon ? 'bg-foreground/70' : 'bg-foreground/35')}
          style={{ width: `${Math.round(due.used * 100)}%` }}
        />
      </span>
    </span>
  )
}
