import type { CatalogueItem, Employee, Order, ResolvedEmployee, Sizes } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { CheckCircle2, Link as LinkIcon, Plus, Printer, RotateCcw, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { ConfirmationSheet } from '@/components/confirmation-sheet'
import { EmployeeForm } from '@/components/employee-form'
import { EmployeePicker } from '@/components/employee-picker'
import { ItemPicker } from '@/components/item-picker'
import { OrderLinesTable } from '@/components/order-lines'
import { QuantityStepper } from '@/components/quantity-stepper'
import { WhatsAppButton } from '@/components/whatsapp-button'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow, stackedBreak } from '@/components/ui/table'
import { useApi, useSession } from '@/lib/api'
import type { NavigateOptions, Prefill, Route } from '@/lib/router'
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
export function CreateOrder({
  prefill,
  navigate,
}: {
  /** A reorder from a dashboard: start the order for this employee with these items. */
  prefill?: Prefill | undefined
  navigate: (to: Route, options?: NavigateOptions) => void
}) {
  const { client } = useApi()
  const session = useSession()
  const itemSetLabel = useId()
  const [placed, setPlaced] = useState<Order | null>(null)
  // Mark as Ordered cannot be undone, so it is confirmed on a summary first.
  const [reviewing, setReviewing] = useState(false)
  const [order, setOrder] = useState<WorkingOrder>(loadDraft)
  const [conflicts, setConflicts] = useState<SizeConflict[]>([])
  const [pendingDefault, setPendingDefault] = useState<PendingDefault | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const [addingEmployee, setAddingEmployee] = useState(false)

  const sizes = useLoad(() => client.sizes())
  const catalogue = useLoad(() => client.catalogue.listActive())
  const itemSets = useLoad(() => client.itemSets.listActive())

  useEffect(() => saveDraft(order), [order])

  /*
   * A reorder arrives once: the address loses its query (a reload must not add
   * the items again) and the ref keeps StrictMode's second run from repeating
   * it. It joins an order in progress for the same employee, and replaces one
   * for someone else only when the user agrees.
   */
  const consumed = useRef<Prefill | null>(null)
  useEffect(() => {
    if (!prefill || consumed.current === prefill) return
    consumed.current = prefill
    navigate({ name: 'createOrder' }, { replace: true, scroll: false })
    const same = order.employee?.id === prefill.employeeId
    if (order.lines.length > 0 && !same && !window.confirm(`Replace the order in progress for ${order.employee?.full_name ?? 'no one yet'} with this reorder?`)) return
    void run(async () => {
      const res = await client.orders.resolve({
        employee_id: prefill.employeeId,
        lines: prefill.items.map((i) => ({ catalogue_item_id: i.id, quantity: i.quantity })),
      })
      setOrder((o) => (same ? addLines(o, res.lines) : reassign(emptyOrder, res.employee, res.lines).order))
      setConflicts([])
      setPendingDefault(null)
    })
    // Runs for a new prefill only; order is read as it is when the reorder arrives.
  }, [prefill])

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

  const applySet = (setId: string) => {
    const employee = order.employee
    if (!employee) return
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

  if (placed) return <OrderedPanel order={placed} navigate={navigate} onNew={() => setPlaced(null)} />

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

      <section className="mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="md:col-span-2 lg:col-span-1">
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
          <p id={itemSetLabel} className="mb-1.5 text-sm font-medium">
            Item Set
          </p>
          {/* One tap applies a set: its lines join the order, merged by item. */}
          <div role="group" aria-labelledby={itemSetLabel} className="flex flex-wrap gap-2">
            {itemSets.data?.map((s) => (
              <Button key={s.id} size="sm" variant="outline" disabled={!order.employee || busy} onClick={() => applySet(s.id)}>
                <Plus aria-hidden />
                <span className="sr-only">Apply </span>
                {s.name}
              </Button>
            ))}
            {itemSets.data?.length === 0 ? <p className="text-sm text-muted-foreground">No item sets yet.</p> : null}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Add Item</p>
          <ItemPicker items={catalogue.data} disabled={busy} onPick={addItem} />
        </div>
      </section>

      {!order.employee ? (
        <p className="mb-4 text-sm text-muted-foreground">Choose who the order is for first: sizes are resolved from their saved defaults.</p>
      ) : null}

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

      {!v.valid && order.lines.length > 0 ? (
        <ul className="mt-4 list-disc pl-5 text-sm text-muted-foreground">
          {v.orderProblems.map((p) => (
            <li key={p}>{p}</li>
          ))}
          {v.lineProblems.size > 0 ? <li>Resolve the highlighted lines.</li> : null}
        </ul>
      ) : null}

      {/*
        Sticky above the phone tab bar (and at the bottom from md), so the
        total and the two actions stay in reach however long the order is.
      */}
      <section
        aria-label="Order actions"
        className={cn(
          'sticky bottom-[var(--bottom-nav)] z-20 mt-4 border-t border-border bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80',
          '-mx-4 px-4 md:-mx-6 md:px-6 xl:-mx-10 xl:px-10 print:hidden',
        )}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="flex items-baseline justify-between gap-3 text-sm md:justify-start">
            <span className="text-muted-foreground">
              {order.lines.length} {order.lines.length === 1 ? 'line' : 'lines'}
              {v.valid ? ' · complete' : order.lines.length > 0 ? ' · not ready' : ''}
            </span>
            <span className="text-base font-semibold tabular-nums">{formatEuro(totalCents(order))}</span>
          </p>
          {/* Side by side while both labels fit; stacked on the narrowest phones. */}
          <div className="flex flex-wrap items-start gap-2 *:flex-auto md:*:flex-none">
            <WhatsAppButton
              disabled={!v.valid || busy}
              text={formatWhatsApp(messageFromWorkingOrder(order, session.name, new Date()))}
            />
            <Button disabled={!v.valid || busy} onClick={() => setReviewing(true)}>
              {busy ? 'Working…' : 'Mark as Ordered…'}
            </Button>
          </div>
        </div>
      </section>

      <ReviewSheet
        open={reviewing}
        order={order}
        busy={busy}
        onClose={() => setReviewing(false)}
        onConfirm={() => {
          // A failure shows on the page, with Retry, and keeps the order.
          setReviewing(false)
          void markAsOrdered()
        }}
      />

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
 * The summary confirmed before Mark as Ordered: who the order is for, each
 * line with its size, quantity and price, and the total. Nothing is stored
 * until Mark as Ordered here.
 */
function ReviewSheet({
  open,
  order,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  order: WorkingOrder
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Review order"
      description={`For ${order.employee?.full_name ?? '—'}${order.employee?.code ? ` · ${order.employee.code}` : ''}. After Mark as Ordered this record cannot be changed.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Back to order
          </Button>
          <Button disabled={busy} onClick={onConfirm}>
            Mark as Ordered
          </Button>
        </>
      }
    >
      <ul aria-label="Order lines" className="flex flex-col divide-y divide-border text-sm">
        {order.lines.map((l) => (
          <li key={l.catalogueItemId} className="flex items-baseline justify-between gap-3 py-2">
            <span className="min-w-0">
              <span className="font-medium">{l.itemName}</span>
              {l.size ? <span className="text-muted-foreground"> · {l.size}</span> : null}
            </span>
            <span className="shrink-0 text-right tabular-nums">
              {l.quantity} × {formatEuro(l.unitPriceCents)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-baseline justify-between border-t border-border pt-3 font-semibold">
        <span>Total</span>
        <span className="text-base tabular-nums">{formatEuro(totalCents(order))}</span>
      </p>
    </FormSheet>
  )
}

/**
 * Shown after Mark as Ordered: the stored, now immutable record, built only
 * from the server's snapshot, and the next step: the employee confirms receipt
 * by a secure link or on the printed record.
 */
function OrderedPanel({ order, navigate, onNew }: { order: Order; navigate: (to: Route) => void; onNew: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [given, setGiven] = useState(false)
  const name = `${order.employee_first_name} ${order.employee_last_name}`
  return (
    <>
      <PageHeader title="Create Order" />
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <CheckCircle2 aria-hidden className="size-5 text-primary" />
            Order {order.record_number} is ordered
            {given ? <Badge>Given</Badge> : <Badge variant="secondary">Ordered</Badge>}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {name}
            {order.employee_code ? ` · ${order.employee_code}` : ''} · prepared by {order.prepared_by_name} ·{' '}
            {new Date(order.ordered_at).toLocaleString()}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <OrderLinesTable order={order} />
          <p className="text-sm text-muted-foreground">
            {given
              ? `${name}'s signed paper confirmation is recorded: the order is Given.`
              : `This record can no longer be edited. Next, ${name} confirms receipt: send a secure link, or print the record for signing. It changes to Given when they confirm.`}
          </p>
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-start">
            {given ? null : (
              <Button className="w-full sm:w-auto" onClick={() => setConfirming(true)}>
                <LinkIcon aria-hidden /> Send confirmation link
              </Button>
            )}
            <WhatsAppButton className="w-full sm:w-auto" text={formatWhatsApp(messageFromOrder(order))} />
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate({ name: 'record', id: order.id, print: true })}>
              <Printer aria-hidden /> Print record
            </Button>
            <Button variant="outline" className="w-full sm:w-auto" onClick={onNew}>
              Start a new order
            </Button>
          </div>
        </CardContent>
      </Card>
      <ConfirmationSheet
        order={confirming ? { ...order, usage_months: null } : null}
        onClose={() => setConfirming(false)}
        onGiven={() => {
          setConfirming(false)
          setGiven(true)
        }}
        onPrint={(id) => navigate({ name: 'record', id, print: true })}
      />
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
    return <EmptyState>No items yet. Use Add Item, or choose an Item Set.</EmptyState>
  }
  /*
   * Where the table is narrow each line is a compact row: the item with its
   * price and service period, the line total and Remove, then size and
   * quantity. From 36rem of room (a tablet in portrait) it is all one line.
   */
  return (
    <Table stack>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead>Size</TableHead>
          <TableHead>Quantity</TableHead>
          <TableHead className="text-right">Unit price</TableHead>
          <TableHead>Service period</TableHead>
          <TableHead className="text-right">Total</TableHead>
          <TableHead className="w-10">
            <span className="sr-only">Remove</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody className="stacked:gap-2">
        {order.lines.map((l) => {
          const lineProblems = problems.get(l.catalogueItemId)
          return (
            <TableRow
              key={l.catalogueItemId}
              className={cn(
                stackedBreak,
                'stacked:gap-x-3 stacked:gap-y-2 stacked:py-2.5 stacked-wide:flex-nowrap stacked-wide:after:hidden',
                lineProblems && 'bg-destructive/5 stacked:border-destructive/40',
              )}
            >
              <TableCell className="align-top whitespace-normal stacked:order-1 stacked:w-auto stacked:min-w-0 stacked:flex-1">
                <div className="font-medium">{l.itemName || 'Unknown item'}</div>
                {l.itemDetails ? <div className="text-xs text-muted-foreground stacked:hidden">{l.itemDetails}</div> : null}
                {/* The unit price and service period columns are hidden in a row: shown here instead. */}
                <div className="hidden text-xs text-muted-foreground tabular-nums stacked:block">
                  {formatEuro(l.unitPriceCents)} · {formatMonths(l.servicePeriodMonths)}
                </div>
                {lineProblems?.map((p) => (
                  <div key={p} role="alert" className="mt-1 text-xs text-destructive">
                    {p}
                  </div>
                ))}
              </TableCell>
              {/* A no-size item's dash says nothing in a row, and there it would push the quantity along. */}
              <TableCell className={cn('align-top stacked:order-3 stacked:w-auto', (l.sizeGroup === 'NONE' || l.sizeGroup === '') && 'stacked:hidden')}>
                <SizeControl line={l} sizes={sizes} onChange={(s) => onSize(l, s)} />
              </TableCell>
              <TableCell className="align-top stacked:order-3 stacked:w-auto">
                <QuantityStepper value={l.quantity} itemName={l.itemName} onChange={(q) => onChange((o) => setQuantity(o, l.catalogueItemId, q))} />
              </TableCell>
              <TableCell className="text-right align-top tabular-nums stacked:hidden">{formatEuro(l.unitPriceCents)}</TableCell>
              <TableCell className="align-top stacked:hidden">{formatMonths(l.servicePeriodMonths)}</TableCell>
              {/* In a narrow row the total sits beside the item, leaving the second line to the controls. */}
              <TableCell className="text-right align-top font-medium tabular-nums stacked:order-1 stacked:w-auto stacked:self-start stacked-wide:order-3 stacked-wide:self-center">
                {l.unitPriceCents !== null && Number.isInteger(l.quantity) ? formatEuro(l.unitPriceCents * l.quantity) : '—'}
              </TableCell>
              <TableCell className="align-top stacked:order-1 stacked:w-auto stacked:-my-1.5 stacked:-mr-2 stacked-wide:order-4 stacked-wide:my-0">
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${l.itemName}`} onClick={() => onChange((o) => removeLine(o, l.catalogueItemId))}>
                  <X aria-hidden />
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
      {/* Rows have no footer; the sticky action bar shows the total. */}
      <TableFooter className="stacked:hidden">
        <TableRow>
          <TableCell colSpan={5} className="text-right font-medium">
            Total value
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums">{formatEuro(totalCents(order))}</TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  )
}

/** Size control per size_group (manual §4.4). No-size items show an en dash. */
function SizeControl({ line, sizes, onChange }: { line: WorkingLine; sizes: Sizes | undefined; onChange: (s: string | null) => void }) {
  if (line.sizeGroup === 'NONE' || line.sizeGroup === '')
    return (
      <span aria-label="No size" className="flex h-9 items-center text-muted-foreground pointer-coarse:h-11 stacked:px-2">
        –
      </span>
    )
  const options =
    line.sizeGroup === 'CLOTHING'
      ? (sizes?.clothing ?? []).map((s) => ({ value: s.code, label: `${s.code} (${s.min_cm}–${s.max_cm} cm)` }))
      : (sizes?.shoes ?? []).map((s) => ({ value: s.code, label: s.code }))
  const missing = line.size === null
  return (
    <div className="flex flex-col gap-1">
      <Select
        aria-label={`Size of ${line.itemName}`}
        className="h-9 w-40 pointer-coarse:h-11 stacked:w-auto stacked:max-w-40"
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
