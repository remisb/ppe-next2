import type { CatalogueItem, Employee, Order, ResolvedEmployee, Sizes } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { CheckCircle2, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { EmployeeForm } from '@/components/employee-form'
import { EmployeePicker } from '@/components/employee-picker'
import { OrderLinesTable } from '@/components/order-lines'
import { WhatsAppButton } from '@/components/whatsapp-button'
import { ErrorState, Loading, PageHeader } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/field'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi, useSession } from '@/lib/api'
import { useLoad } from '@/lib/use-load'
import { cn, formatEuro, formatMonths } from '@/lib/utils'
import { formatWhatsApp, messageFromOrder, messageFromWorkingOrder } from '@/lib/whatsapp'
import {
  type SizeConflict,
  type WorkingLine,
  type WorkingOrder,
  acceptResolvedSize,
  addLines,
  applySavedDefault,
  clearDraft,
  emptyOrder,
  lineFromCatalogue,
  loadDraft,
  reassign,
  removeLine,
  saveDraft,
  setManualSize,
  setQuantity,
  toMarkAsOrderedInput,
  totalCents,
  validate,
} from '@/lib/working-order'

function toResolvedEmployee(e: Employee): ResolvedEmployee {
  const { id, first_name, last_name, full_name, code, height_cm, clothing_size, shoe_size } = e
  return { id, first_name, last_name, full_name, code, height_cm, clothing_size, shoe_size }
}

/** A failed action, kept so the user can Retry without losing the form. */
interface Failure {
  error: unknown
  retry: () => void
}

interface PendingDefault {
  catalogueItemId: string
  group: 'CLOTHING' | 'SHOES'
  size: string
}

/**
 * Create Order (manual §3.1). Everything here is working state: nothing is
 * stored on the server until Mark as Ordered.
 */
export function CreateOrder() {
  const { client } = useApi()
  const session = useSession()
  const [placed, setPlaced] = useState<Order | null>(null)
  const [order, setOrder] = useState<WorkingOrder>(loadDraft)
  const [conflicts, setConflicts] = useState<SizeConflict[]>([])
  const [pendingDefault, setPendingDefault] = useState<PendingDefault | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const [addingEmployee, setAddingEmployee] = useState(false)
  const [setId, setSetId] = useState('')

  const sizes = useLoad(() => client.sizes())
  const catalogue = useLoad(() => client.catalogue.listActive())
  const itemSets = useLoad(() => client.itemSets.listActive())

  useEffect(() => saveDraft(order), [order])

  /** Run a server call; on failure keep all state and offer Retry. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setFailure(null)
    try {
      await action()
    } catch (error) {
      setFailure({ error, retry: () => void run(action) })
    } finally {
      setBusy(false)
    }
  }

  const selectEmployee = (employeeId: string) =>
    run(async () => {
      const res = await client.orders.resolve({
        employee_id: employeeId,
        lines: order.lines.map((l) => ({ catalogue_item_id: l.catalogueItemId, quantity: validQty(l.quantity) })),
      })
      const next = reassign(order, res.employee, res.lines)
      setOrder(next.order)
      setConflicts(next.conflicts)
      setPendingDefault(null)
    })

  const addItem = (item: CatalogueItem) => {
    const employee = order.employee
    if (!employee) {
      setOrder((o) => addLines(o, [lineFromCatalogue(item)]))
      return
    }
    void run(async () => {
      const res = await client.orders.resolve({ employee_id: employee.id, lines: [{ catalogue_item_id: item.id, quantity: 1 }] })
      setOrder((o) => addLines(o, res.lines))
    })
  }

  const applySet = () => {
    const employee = order.employee
    if (!employee || !setId) return
    void run(async () => {
      const res = await client.itemSets.apply(setId, employee.id)
      setOrder((o) => addLines(o, res.lines))
    })
  }

  const chooseSize = (line: WorkingLine, size: string | null) => {
    setOrder((o) => setManualSize(o, line.catalogueItemId, size))
    setConflicts((cs) => cs.filter((c) => c.catalogueItemId !== line.catalogueItemId))
    const emp = order.employee
    const group = line.sizeGroup
    // Offer Save as Employee Default when the employee has no default for this group.
    if (emp && size && (group === 'CLOTHING' || group === 'SHOES')) {
      const saved = group === 'CLOTHING' ? emp.clothing_size : emp.shoe_size
      setPendingDefault(saved === null ? { catalogueItemId: line.catalogueItemId, group, size } : null)
    }
  }

  const saveDefault = (p: PendingDefault) => {
    const emp = order.employee
    if (!emp) return
    void run(async () => {
      const updated = await client.employees.updateSizes(emp.id, {
        height_cm: emp.height_cm,
        clothing_size: p.group === 'CLOTHING' ? p.size : emp.clothing_size,
        shoe_size: p.group === 'SHOES' ? p.size : emp.shoe_size,
      })
      setOrder((o) => applySavedDefault(o, toResolvedEmployee(updated), p.group, p.size))
      setPendingDefault(null)
    })
  }

  /** Mark as Ordered (algorithm B). On failure the working order is kept. */
  const markAsOrdered = () =>
    run(async () => {
      const o = await client.orders.markAsOrdered(toMarkAsOrderedInput(order))
      clearDraft()
      setOrder(emptyOrder)
      setConflicts([])
      setPendingDefault(null)
      setPlaced(o)
    })

  const reset = () => {
    if (order.lines.length > 0 && !window.confirm('Clear this order? Unsaved lines will be lost.')) return
    clearDraft()
    setOrder(emptyOrder)
    setConflicts([])
    setPendingDefault(null)
    setFailure(null)
  }

  const v = validate(order)
  const loadError = sizes.error ?? catalogue.error ?? itemSets.error

  if (placed) return <OrderedPanel order={placed} onNew={() => setPlaced(null)} />

  return (
    <>
      <PageHeader
        title="Create Order"
        description="Prepare a supplier order for one employee. Nothing is final until Mark as Ordered."
        actions={
          <Button variant="outline" onClick={reset}>
            <RotateCcw aria-hidden /> New order
          </Button>
        }
      />

      {loadError ? (
        <ErrorState error={loadError} onRetry={() => { sizes.reload(); catalogue.reload(); itemSets.reload() }} />
      ) : null}
      {failure ? (
        failure.error instanceof ApiError && failure.error.isConflict ? (
          <ErrorState
            title="Cannot mark as ordered"
            error={new Error(`${failure.error.message}. An authorised user must complete or reactivate it in the Item Catalogue, or remove the line.`)}
          />
        ) : (
          <ErrorState title="That did not work" error={failure.error} onRetry={failure.retry} />
        )
      ) : null}

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <p className="mb-1.5 text-sm font-medium">Assigned to</p>
          <EmployeePicker
            label="Assigned to"
            selected={order.employee}
            disabled={busy}
            onSelect={(e) => void selectEmployee(e.id)}
            onAddNew={() => setAddingEmployee(true)}
          />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Item Set</p>
          <div className="flex gap-2">
            <Select aria-label="Item Set" value={setId} onChange={(e) => setSetId(e.target.value)} disabled={!order.employee}>
              <option value="">Choose an item set…</option>
              {itemSets.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Button variant="outline" disabled={!order.employee || !setId || busy} onClick={applySet}>
              Apply Item Set
            </Button>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Add Item</p>
          <Select
            aria-label="Add Item"
            value=""
            disabled={busy || !catalogue.data}
            onChange={(e) => {
              const item = catalogue.data?.find((i) => i.id === e.target.value)
              if (item) addItem(item)
            }}
          >
            <option value="">Choose an item to add…</option>
            {catalogue.data?.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
                {i.details ? ` — ${i.details}` : ''}
              </option>
            ))}
          </Select>
        </div>
      </section>

      {conflicts.length > 0 ? (
        <Alert className="mb-4">
          <AlertTitle>Check sizes for {order.employee?.full_name}</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 flex flex-col gap-2">
              {conflicts.map((c) => (
                <li key={c.catalogueItemId} className="flex flex-wrap items-center gap-2">
                  <span>
                    {c.itemName}: you chose <strong>{c.manualSize}</strong>;{' '}
                    {c.resolvedSize ? (
                      <>
                        resolved size is <strong>{c.resolvedSize}</strong>.
                      </>
                    ) : (
                      <>this employee has no saved size.</>
                    )}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOrder((o) => acceptResolvedSize(o, c))
                      setConflicts((cs) => cs.filter((x) => x !== c))
                    }}
                  >
                    {c.resolvedSize ? `Use ${c.resolvedSize}` : 'Clear size'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setOrder((o) => removeLine(o, c.catalogueItemId))
                      setConflicts((cs) => cs.filter((x) => x !== c))
                    }}
                  >
                    Remove line
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConflicts((cs) => cs.filter((x) => x !== c))}>
                    Keep {c.manualSize}
                  </Button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {pendingDefault && order.employee ? (
        <Alert className="mb-4">
          <AlertTitle>Save as Employee Default?</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {order.employee.full_name} has no saved {pendingDefault.group === 'CLOTHING' ? 'clothing' : 'shoe'} size. Save{' '}
              <strong>{pendingDefault.size}</strong> for future orders?
            </span>
            <Button size="sm" onClick={() => saveDefault(pendingDefault)} disabled={busy}>
              Save as Employee Default
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingDefault(null)}>
              This order only
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!catalogue.data && !loadError ? (
        <Loading />
      ) : (
        <LinesTable order={order} sizes={sizes.data} problems={v.lineProblems} onSize={chooseSize} onChange={setOrder} />
      )}

      <section className="mt-4 flex flex-wrap items-start justify-between gap-4">
        {v.valid ? (
          <p className="text-sm text-muted-foreground">The order is complete.</p>
        ) : (
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {v.orderProblems.map((p) => (
              <li key={p}>{p}</li>
            ))}
            {v.lineProblems.size > 0 ? <li>Resolve the highlighted lines.</li> : null}
          </ul>
        )}
        <div className="flex flex-wrap items-start gap-2">
          <WhatsAppButton
            disabled={!v.valid || busy}
            text={formatWhatsApp(messageFromWorkingOrder(order, session.name, new Date()))}
          />
          <Button disabled={!v.valid || busy} onClick={() => void markAsOrdered()}>
            {busy ? 'Working…' : 'Mark as Ordered'}
          </Button>
        </div>
      </section>

      <EmployeeForm
        open={addingEmployee}
        sizes={sizes.data}
        submitLabel="Save and Select Employee"
        onClose={() => setAddingEmployee(false)}
        onSaved={(e) => {
          setAddingEmployee(false)
          void selectEmployee(e.id)
        }}
      />
    </>
  )
}

/**
 * Shown after Mark as Ordered: the stored, now immutable record, built only
 * from the server's snapshot.
 */
function OrderedPanel({ order, onNew }: { order: Order; onNew: () => void }) {
  return (
    <>
      <PageHeader title="Create Order" />
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <CheckCircle2 aria-hidden className="size-5 text-primary" />
            Order {order.record_number} is ordered
            <Badge variant="secondary">Ordered</Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {order.employee_first_name} {order.employee_last_name}
            {order.employee_code ? ` · ${order.employee_code}` : ''} · prepared by {order.prepared_by_name} ·{' '}
            {new Date(order.ordered_at).toLocaleString()}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <OrderLinesTable order={order} />
          <p className="text-sm text-muted-foreground">
            This record can no longer be edited. It changes to Given when the employee confirms receipt.
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <WhatsAppButton text={formatWhatsApp(messageFromOrder(order))} />
            <Button onClick={onNew}>Start a new order</Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

/** Quantities sent for resolution must be valid; an invalid typed value resolves as 1 and stays flagged locally. */
function validQty(q: number): number {
  return Number.isInteger(q) && q >= 1 ? q : 1
}

function LinesTable({
  order,
  sizes,
  problems,
  onSize,
  onChange,
}: {
  order: WorkingOrder
  sizes: Sizes | undefined
  problems: Map<string, string[]>
  onSize: (l: WorkingLine, size: string | null) => void
  onChange: (f: (o: WorkingOrder) => WorkingOrder) => void
}) {
  if (order.lines.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        No items yet. Use Add Item or Apply Item Set.
      </p>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>Size</TableHead>
          <TableHead className="w-24">Quantity</TableHead>
          <TableHead className="text-right">Unit price</TableHead>
          <TableHead>Service period</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="w-10">
            <span className="sr-only">Remove</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {order.lines.map((l) => {
          const lineProblems = problems.get(l.catalogueItemId)
          return (
            <TableRow key={l.catalogueItemId} className={cn(lineProblems && 'bg-destructive/5')}>
              <TableCell className="align-top">
                <div className="font-medium">{l.itemName || 'Unknown item'}</div>
                {l.itemDetails ? <div className="text-xs text-muted-foreground">{l.itemDetails}</div> : null}
                {lineProblems?.map((p) => (
                  <div key={p} role="alert" className="mt-1 text-xs text-destructive">
                    {p}
                  </div>
                ))}
              </TableCell>
              <TableCell className="align-top">
                <SizeControl line={l} sizes={sizes} onChange={(s) => onSize(l, s)} />
              </TableCell>
              <TableCell className="align-top">
                <Input
                  aria-label={`Quantity of ${l.itemName}`}
                  inputMode="numeric"
                  className="w-20"
                  invalid={!Number.isInteger(l.quantity) || l.quantity < 1}
                  value={Number.isNaN(l.quantity) ? '' : String(l.quantity)}
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    onChange((o) => setQuantity(o, l.catalogueItemId, raw === '' ? Number.NaN : Number(raw)))
                  }}
                />
              </TableCell>
              <TableCell className="text-right align-top">{formatEuro(l.unitPriceCents)}</TableCell>
              <TableCell className="align-top">{formatMonths(l.servicePeriodMonths)}</TableCell>
              <TableCell className="text-right align-top">
                {l.unitPriceCents !== null && Number.isInteger(l.quantity) ? formatEuro(l.unitPriceCents * l.quantity) : '—'}
              </TableCell>
              <TableCell className="align-top">
                <Button size="icon" variant="ghost" aria-label={`Remove ${l.itemName}`} onClick={() => onChange((o) => removeLine(o, l.catalogueItemId))}>
                  <X aria-hidden />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={5} className="text-right font-medium">
            Total value
          </TableCell>
          <TableCell className="text-right font-semibold">{formatEuro(totalCents(order))}</TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  )
}

/** Size control per size_group (manual §4.4). No-size items show an en dash. */
function SizeControl({ line, sizes, onChange }: { line: WorkingLine; sizes: Sizes | undefined; onChange: (s: string | null) => void }) {
  if (line.sizeGroup === 'NONE' || line.sizeGroup === '') return <span aria-label="No size">–</span>
  const options =
    line.sizeGroup === 'CLOTHING'
      ? (sizes?.clothing ?? []).map((s) => ({ value: s.code, label: `${s.code} (${s.min_cm}–${s.max_cm} cm)` }))
      : (sizes?.shoes ?? []).map((s) => ({ value: s.code, label: s.code }))
  const missing = line.size === null
  return (
    <div className="flex flex-col gap-1">
      <Select
        aria-label={`Size of ${line.itemName}`}
        className="w-40"
        invalid={missing}
        value={line.size ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Select size…</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {line.sizeSource === 'suggested' ? (
        <Badge variant="outline" className="w-fit">
          Suggested from height
        </Badge>
      ) : null}
    </div>
  )
}
