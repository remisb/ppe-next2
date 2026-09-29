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
    if (!window.confirm(`Delete ${emp.full_name}? Their past orders are kept.`)) return
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
        <ArrowLeft aria-hidden /> Employees
      </Button>
      {employee.error ? (
        <ErrorState error={employee.error} onRetry={employee.reload} />
      ) : !e ? (
        <Loading />
      ) : (
        <>
          <PageHeader
            title={e.full_name}
            {...(e.code ? { description: `Code ${e.code}` } : {})}
            actions={
              <>
                <Button onClick={() => navigate({ name: 'createOrder', prefill: { employeeId: e.id, items: [] } })}>
                  <Plus aria-hidden /> New order
                </Button>
                <Button variant="outline" onClick={() => setSizing(true)}>
                  Edit Sizes
                </Button>
                <MoreActions label={`More actions for ${e.full_name}`}>
                  <DropdownMenuItem onClick={() => setEditing(true)}>Edit details</DropdownMenuItem>
                  {session.canManageItems ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onClick={() => void remove(e)}>
                        Delete employee…
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </MoreActions>
              </>
            }
          />
          <dl className="mb-8 grid grid-cols-3 gap-4 rounded-lg border border-border p-4 text-sm sm:max-w-lg">
            <Fact label="Height">{e.height_cm ? `${e.height_cm} cm` : '—'}</Fact>
            <Fact label="Clothing">{missing.clothing ? <MissingBadge /> : clothingSizeLabel(clothingBands(sizes.data?.clothing ?? []), e.clothing_size)}</Fact>
            <Fact label="Shoes">{missing.shoes ? <MissingBadge /> : formatSize(e.shoe_size)}</Fact>
            {e.notes ? (
              <div className="col-span-3">
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 whitespace-pre-line">{e.notes}</dd>
              </div>
            ) : null}
          </dl>

          {reorder.length > 0 ? (
            <Alert className="mb-6">
              <RotateCcw aria-hidden />
              <AlertTitle>
                {reorder.length === 1 ? '1 item is' : `${reorder.length} items are`} due for replacement
              </AlertTitle>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>
                  {reorder
                    .map((d) => `${d.item.itemName}${d.overdue ? ' (overdue)' : ` (due ${formatDate(d.dueAt.toISOString(), tz ?? 'UTC')})`}`)
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
                  Reorder {reorder.length === 1 ? 'it' : `all ${reorder.length}`}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {actionError ? <ErrorState title="Action failed" error={actionError} /> : null}

          <section aria-labelledby="items-given" className="mb-8">
            <h2 id="items-given" className="mb-1 text-lg font-semibold">
              Items given
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              As recorded on each receipt; later catalogue changes do not alter them.
              {tz ? ` Dates are shown in ${tz}.` : ''}
            </p>
            {orders.error ? (
              <ErrorState error={orders.error} onRetry={orders.reload} />
            ) : !orders.data ? (
              <Loading />
            ) : items.given.length === 0 ? (
              <EmptyState>No items have been given to {e.first_name} yet.</EmptyState>
            ) : (
              <ItemsTable items={items.given} dateLabel="Given" tz={tz} due={dueByLine} navigate={navigate} />
            )}
          </section>

          {items.ordered.length > 0 ? (
            <section aria-labelledby="items-ordered" className="mb-8">
              <h2 id="items-ordered" className="mb-1 text-lg font-semibold">
                Ordered, not yet given
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">Waiting for the employee to confirm receipt.</p>
              <ItemsTable items={items.ordered} dateLabel="Ordered" tz={tz} navigate={navigate} />
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
  dateLabel,
  tz,
  due,
  navigate,
}: {
  items: EmployeeItem[]
  dateLabel: string
  tz: string | undefined
  /** For given items: when each item's latest line is due for replacement. Older lines are replaced. */
  due?: Map<string, Due>
  navigate: (to: Route) => void
}) {
  const given = dateLabel === 'Given'
  const [sort, setSort] = useState<SortState<ItemSort> | null>(null)
  const sortProps = { sort, onSort: setSort, allowNone: true }
  const columns: SortColumn<ItemSort>[] = [
    { key: 'item', label: 'Item' },
    { key: 'size', label: 'Size' },
    { key: 'quantity', label: 'Quantity' },
    { key: 'date', label: dateLabel, firstDir: 'desc' },
    ...(given ? [{ key: 'usage', label: 'Usage time' } as const] : []),
    { key: 'period', label: 'Service period' },
    ...(due ? [{ key: 'due', label: 'Replacement' } as const] : []),
    { key: 'record', label: given ? 'Receipt' : 'Record' },
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
    <Table stack stackBelow="lg" sortControl={<SortControl columns={columns} noneLabel="Newest first" {...sortProps} />}>
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
            <TableCell label="Size" className="stacked:order-2">{i.size ?? '–'}</TableCell>
            <TableCell label="Quantity" className="text-right tabular-nums stacked:order-2">{i.quantity}</TableCell>
            <TableCell label={dateLabel} className="tabular-nums stacked:order-2">
              <RelativeDate iso={i.at} timeZone={tz} time />
            </TableCell>
            {given ? (
              <TableCell label="Usage time" className="stacked:order-2">{formatUsage(i.usageMonths) || '—'}</TableCell>
            ) : null}
            <TableCell label="Service period" className="stacked:order-2">{formatMonths(i.servicePeriodMonths)}</TableCell>
            {due ? (
              <TableCell label="Replacement" className="stacked:order-2">
                <DueCell due={due.get(i.key)} tz={tz} />
              </TableCell>
            ) : null}
            <TableCell label={given ? 'Receipt' : 'Record'} className="stacked:order-3">
              {/* A given order opens its receipt, one on order its page in History; either previews on hover. */}
              {given ? (
                <RecordPreview
                  orderId={i.orderId}
                  timeZone={tz}
                  {...linkTo({ name: 'record', id: i.orderId }, navigate)}
                  aria-label={`Receipt ${i.recordNumber}`}
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
                  <Badge variant="secondary">Ordered</Badge>
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
  if (!due) return <span className="text-muted-foreground">Replaced</span>
  if (due.reordered) return <Badge variant="secondary">Reordered</Badge>
  const date = formatDate(due.dueAt.toISOString(), tz ?? 'UTC')
  return (
    <span className="flex min-w-36 flex-col items-start gap-1 stacked:items-end">
      <span className={cn('tabular-nums', due.overdue ? 'font-medium text-destructive' : due.dueSoon && 'font-medium')}>
        {due.overdue ? `Overdue since ${date}` : `Due ${date}`}
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
