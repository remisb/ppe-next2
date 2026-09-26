import type { Client, ListedOrder } from '@ppe/api-client'
import { ArrowLeft, FileText } from 'lucide-react'
import { useMemo, useState } from 'react'

import { EmployeeForm } from '@/components/employee-form'
import { SortControl, SortableHead } from '@/components/sortable'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/components/ui/table'
import { useApi } from '@/lib/api'
import { type EmployeeItem, employeeItems } from '@/lib/employee-items'
import { formatDateTime, formatUsage } from '@/lib/history'
import { type Route, linkTo } from '@/lib/router'
import { type SortColumn, type SortState, type SortValue, rankIn, sortRows } from '@/lib/sort'
import { useLoad } from '@/lib/use-load'
import { formatMonths, formatSize } from '@/lib/utils'

import { EditSizes } from './employees'

/** Every stored order of one employee; History pages hold at most 100. */
async function allOrders(client: Client, employeeId: string): Promise<ListedOrder[]> {
  const orders: ListedOrder[] = []
  for (let page = 1; ; page++) {
    const res = await client.orders.list({ employee_id: employeeId, page, page_size: 100 })
    orders.push(...res.orders)
    if (res.orders.length === 0 || orders.length >= res.total) return orders
  }
}

/**
 * One employee (/employees/<id>): details and size defaults, the items given
 * to them with a link to each receipt, and items ordered but not yet given.
 * Items come from order snapshots, so they show what was actually issued.
 */
export function EmployeePage({ id, navigate, onBack }: { id: string; navigate: (to: Route) => void; onBack: () => void }) {
  const { client } = useApi()
  const employee = useLoad(() => client.employees.get(id), [id])
  const orders = useLoad(() => allOrders(client, id), [id])
  const settings = useLoad(() => client.settings())
  const sizes = useLoad(() => client.sizes())
  const [editing, setEditing] = useState(false)
  const [sizing, setSizing] = useState(false)

  const items = useMemo(() => employeeItems(orders.data ?? []), [orders.data])
  const tz = settings.data?.timezone
  const clothing = useMemo(() => sizes.data?.clothing.map((s) => s.code) ?? [], [sizes.data])
  const e = employee.data

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
                <Button variant="outline" onClick={() => setSizing(true)}>
                  Edit Sizes
                </Button>
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </>
            }
          />
          <dl className="mb-8 grid grid-cols-3 gap-4 rounded-lg border border-border p-4 text-sm sm:max-w-lg">
            <Fact label="Height">{e.height_cm ? `${e.height_cm} cm` : '—'}</Fact>
            <Fact label="Clothing">{formatSize(e.clothing_size)}</Fact>
            <Fact label="Shoes">{formatSize(e.shoe_size)}</Fact>
            {e.notes ? (
              <div className="col-span-3">
                <dt className="text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 whitespace-pre-line">{e.notes}</dd>
              </div>
            ) : null}
          </dl>

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
              <ItemsTable items={items.given} dateLabel="Given" tz={tz} clothing={clothing} navigate={navigate} />
            )}
          </section>

          {items.ordered.length > 0 ? (
            <section aria-labelledby="items-ordered" className="mb-8">
              <h2 id="items-ordered" className="mb-1 text-lg font-semibold">
                Ordered, not yet given
              </h2>
              <p className="mb-3 text-sm text-muted-foreground">Waiting for the employee to confirm receipt.</p>
              <ItemsTable items={items.ordered} dateLabel="Ordered" tz={tz} clothing={clothing} navigate={navigate} />
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

type ItemSort = 'item' | 'size' | 'quantity' | 'date' | 'usage' | 'period' | 'record'

/**
 * Sizes in size order: clothing S … 3XL by the vocabulary, then shoe sizes by
 * number, rather than by spelling (which puts L before M before S).
 */
function sizeValue(size: string | null, clothing: readonly string[]): SortValue {
  if (!size) return null
  const n = Number(size)
  return Number.isFinite(n) ? 1000 + n : rankIn(clothing, size)
}

/**
 * Given items link to their receipt (View Record). An ORDERED order has no
 * receipt yet (manual §6), so its record number is plain text. Each table
 * sorts on its own; with no sort it keeps newest activity first.
 */
function ItemsTable({
  items,
  dateLabel,
  tz,
  clothing,
  navigate,
}: {
  items: EmployeeItem[]
  dateLabel: string
  tz: string | undefined
  clothing: readonly string[]
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
    { key: 'record', label: given ? 'Receipt' : 'Record' },
  ]
  const shown = useMemo(
    () =>
      sortRows(items, sort, (i, key) => {
        switch (key) {
          case 'item':
            return i.itemName
          case 'size':
            return sizeValue(i.size, clothing)
          case 'quantity':
            return i.quantity
          case 'date':
            return i.at
          case 'usage':
            return i.usageMonths
          case 'period':
            return i.servicePeriodMonths
          case 'record':
            return i.recordNumber
        }
      }),
    [items, sort, clothing],
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
            <TableCell label={dateLabel} className="tabular-nums stacked:order-2">{formatDateTime(i.at, tz)}</TableCell>
            {given ? (
              <TableCell label="Usage time" className="stacked:order-2">{formatUsage(i.usageMonths) || '—'}</TableCell>
            ) : null}
            <TableCell label="Service period" className="stacked:order-2">{formatMonths(i.servicePeriodMonths)}</TableCell>
            <TableCell label={given ? 'Receipt' : 'Record'} className="stacked:order-3">
              {given ? (
                <a
                  {...linkTo({ name: 'record', id: i.orderId }, navigate)}
                  aria-label={`Receipt ${i.recordNumber}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-0"
                >
                  <FileText aria-hidden className="size-4" />
                  {i.recordNumber}
                </a>
              ) : (
                <span className="inline-flex items-center gap-2">
                  {i.recordNumber} <Badge variant="secondary">Ordered</Badge>
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
