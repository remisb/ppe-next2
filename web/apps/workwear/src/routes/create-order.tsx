import type { CatalogueIcon, CatalogueItem, ConfirmationLink, Employee, ItemSet, ListedOrder, Order, ResolvedEmployee, Sizes } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { Check, CheckCircle2, Link as LinkIcon, Plus, Printer, RotateCcw, X } from 'lucide-react'
import { Fragment, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'

import { ConfirmationLinkView, ConfirmationSheet } from '@/components/confirmation-sheet'
import { formatDate } from '@/components/dashboard'
import { EmployeeForm } from '@/components/employee-form'
import { EmployeePicker } from '@/components/employee-picker'
import { ItemTile } from '@/components/item-icon'
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
import { intlLocale, t } from '@/i18n'
import { useApi, useSession } from '@/lib/api'
import { lastOrder, linesText, loadCreateLink, saveCreateLink, setOnOrder, sizeParts } from '@/lib/composer'
import { type Due, loadEmployeeOrders, replacementsDue } from '@/lib/employee-items'
import { type NavigateOptions, type Prefill, type Route, linkTo } from '@/lib/router'
import { useLoad } from '@/lib/use-load'
import { clothingBandValue, clothingBands, cn, formatEuro, formatMonths } from '@/lib/utils'
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

/** After Mark as Ordered: the stored order, and the confirmation link if the review created one. */
interface Placed {
  order: Order
  link?: ConfirmationLink
  linkError?: unknown
}

/** An item the employee is due to have replaced, with its catalogue row. */
interface DueItem {
  due: Due
  item: CatalogueItem
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
  /** A reorder (start the order for this employee with these items) or an item set's items. */
  prefill?: Prefill | undefined
  navigate: (to: Route, options?: NavigateOptions) => void
}) {
  const { client } = useApi()
  const session = useSession()
  const itemSetLabel = useId()
  const [placed, setPlaced] = useState<Placed | null>(null)
  // Mark as Ordered cannot be undone, so it is confirmed on a summary first.
  const [reviewing, setReviewing] = useState(false)
  // The review creates the employee's confirmation link as well, unless this device turned that off.
  const [createLink, setCreateLink] = useState(loadCreateLink)
  const [order, setOrder] = useState<WorkingOrder>(() => loadDraft(session.userId))
  const [conflicts, setConflicts] = useState<SizeConflict[]>([])
  const [pendingDefault, setPendingDefault] = useState<PendingDefault | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const [addingEmployee, setAddingEmployee] = useState(false)

  const sizes = useLoad(() => client.sizes())
  const catalogue = useLoad(() => client.catalogue.listActive())
  const itemSets = useLoad(() => client.itemSets.listActive())

  useEffect(() => saveDraft(order, session.userId), [order, session.userId])

  /*
   * A reorder arrives once: the address loses its query (a reload must not add
   * the items again) and the ref keeps StrictMode's second run from repeating
   * it. It joins an order in progress for the same employee, and replaces one
   * for someone else only when the user agrees. Items with no employee (an
   * item set's Use in new order) join the order in progress, whoever it is for.
   */
  const consumed = useRef<Prefill | null>(null)
  useEffect(() => {
    if (!prefill || consumed.current === prefill) return
    consumed.current = prefill
    navigate({ name: 'createOrder' }, { replace: true, scroll: false })
    const lines = prefill.items.map((i) => ({ catalogue_item_id: i.id, quantity: i.quantity }))
    const target = prefill.employeeId ?? order.employee?.id
    if (!target) {
      // No one chosen yet: the lines wait unresolved, as Add Item's do, until the employee is.
      void run(async () => {
        const active = new Map((await client.catalogue.listActive()).map((i) => [i.id, i]))
        setOrder((o) =>
          addLines(o, prefill.items.flatMap((i) => {
            const item = active.get(i.id)
            return item ? [lineFromCatalogue(item, i.quantity)] : []
          })),
        )
      })
      return
    }
    const same = order.employee?.id === target
    if (order.lines.length > 0 && !same && !window.confirm(t.order.replaceConfirm(order.employee?.full_name ?? t.order.noOneYet))) return
    void run(async () => {
      const res = await client.orders.resolve({ employee_id: target, lines })
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

  /** Adds items, each resolved for the employee (size, current price); quantities default to 1. */
  const addItems = (items: { item: CatalogueItem; quantity?: number }[]) => {
    const employee = order.employee
    if (!employee) {
      setOrder((o) => addLines(o, items.map(({ item, quantity }) => lineFromCatalogue(item, quantity))))
      return
    }
    void run(async () => {
      const res = await client.orders.resolve({
        employee_id: employee.id,
        lines: items.map(({ item, quantity = 1 }) => ({ catalogue_item_id: item.id, quantity })),
      })
      setOrder((o) => addLines(o, res.lines))
    })
  }
  const addItem = (item: CatalogueItem) => addItems([{ item }])

  // What the employee is due to have replaced (overdue or within 30 days), from
  // their order history, and not already on this order or on another one.
  const employeeId = order.employee?.id
  const history = useLoad(() => (employeeId ? loadEmployeeOrders(client, employeeId) : Promise.resolve([])), [employeeId])
  const settings = useLoad(() => client.settings())
  const tz = settings.data?.timezone ?? 'UTC'
  const dueAll = useMemo<DueItem[]>(() => {
    const active = new Map(catalogue.data?.map((i) => [i.id, i]))
    return replacementsDue(employeeId ? (history.data ?? []) : [], new Date()).flatMap((d) => {
      const item = active.get(d.item.catalogueItemId)
      return item && d.dueSoon && !d.reordered ? [{ due: d, item }] : []
    })
  }, [history.data, employeeId, catalogue.data])
  const onThisOrder = useMemo(() => new Set(order.lines.map((l) => l.catalogueItemId)), [order.lines])
  const dueNow = dueAll.filter((d) => !onThisOrder.has(d.item.id))
  const last = employeeId ? lastOrder(history.data ?? []) : undefined
  const bands = useMemo(() => clothingBands(sizes.data?.clothing ?? []), [sizes.data])

  const applySet = (set: ItemSet) => {
    const employee = order.employee
    if (!employee) return
    // Applying a set again adds its quantities to the lines already here.
    if (setOnOrder(set, order.lines) && !window.confirm(t.order.setOnOrderConfirm(set.name))) return
    void run(async () => {
      const res = await client.itemSets.apply(set.id, employee.id)
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
        // The employee keeps the EU number; the line keeps its code ("54").
        clothing_size: p.group === 'CLOTHING' ? Number(p.size) : emp.clothing_size,
        shoe_size: p.group === 'SHOES' ? p.size : emp.shoe_size,
      })
      setOrder((o) => applySavedDefault(o, toResolvedEmployee(updated), p.group, p.size))
      setPendingDefault(null)
    })
  }

  /**
   * Mark as Ordered (algorithm B). On failure the working order is kept. The
   * confirmation link is created after, when asked; the order stands even if
   * that fails, and the success screen offers to send one.
   */
  const markAsOrdered = (withLink: boolean) =>
    run(async () => {
      const o = await client.orders.markAsOrdered(toMarkAsOrderedInput(order))
      clearDraft(session.userId)
      setOrder(emptyOrder)
      setConflicts([])
      setPendingDefault(null)
      let next: Placed = { order: o }
      if (withLink) {
        try {
          next = { order: o, link: await client.orders.createConfirmationLink(o.id) }
        } catch (linkError) {
          next = { order: o, linkError }
        }
      }
      setPlaced(next)
    })

  const reset = () => {
    if (order.lines.length > 0 && !window.confirm(t.order.clearConfirm)) return
    clearDraft(session.userId)
    setOrder(emptyOrder)
    setConflicts([])
    setPendingDefault(null)
    setFailure(null)
  }

  const v = validate(order)
  const loadError = sizes.error ?? catalogue.error ?? itemSets.error

  // ⌘Enter / Ctrl+Enter opens the review, from anywhere on the screen, once the order is complete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && v.valid && !busy && !placed && !document.querySelector('dialog[open]')) {
        e.preventDefault()
        setReviewing(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [v.valid, busy, placed])

  if (placed) return <OrderedPanel placed={placed} navigate={navigate} onNew={() => setPlaced(null)} />
  const whatsappText = formatWhatsApp(messageFromWorkingOrder(order, session.name, new Date()))

  return (
    <>
      <PageHeader
        title={t.order.title}
        description={t.order.description}
        actions={
          <Button variant="outline" onClick={reset}>
            <RotateCcw aria-hidden /> {t.order.newOrder}
          </Button>
        }
      />

      {loadError ? (
        <ErrorState error={loadError} onRetry={() => { sizes.reload(); catalogue.reload(); itemSets.reload() }} />
      ) : null}
      {failure ? (
        failure.error instanceof ApiError && failure.error.isConflict ? (
          <ErrorState
            title={t.order.cannotMarkAsOrdered}
            error={new Error(t.order.conflictHelp(failure.error.message))}
          />
        ) : (
          <ErrorState title={t.order.thatDidNotWork} error={failure.error} onRetry={failure.retry} />
        )
      ) : null}

      {/* The composer: a container, so the summary sits beside the lines wherever the content has room (composer-wide). */}
      <div className="@container/order">
      <div className="composer-wide:grid composer-wide:grid-cols-[minmax(0,1fr)_17rem] composer-wide:items-start composer-wide:gap-6">
      <div className="min-w-0">
      <section className="mb-6 grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-sm font-medium">{t.order.assignedTo}</p>
          <EmployeePicker
            label={t.order.assignedTo}
            selected={order.employee}
            disabled={busy}
            onSelect={(e) => void selectEmployee(e.id)}
            onAddNew={() => setAddingEmployee(true)}
          />
          {/* The saved sizes explain how each line's size was resolved. */}
          {order.employee ? (
            <p aria-label={t.order.savedSizesOf(order.employee.full_name)} className="mt-1.5 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
              {sizeParts(order.employee, bands).map((part, i) => (
                <span key={part.label} className={cn(part.missing && 'font-medium text-destructive')}>
                  {i > 0 ? <span aria-hidden>· </span> : null}
                  {part.label}
                </span>
              ))}
            </p>
          ) : null}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t.order.addItem}</p>
          <ItemPicker items={catalogue.data} disabled={busy} onPick={addItem} />
        </div>
        <div className="md:col-span-2">
          <p id={itemSetLabel} className="mb-1.5 text-sm font-medium">
            {t.order.itemSet}
          </p>
          {/* One tap applies a set: its lines join the order, merged by item. A ✓ marks a set already on it. */}
          <div role="group" aria-labelledby={itemSetLabel} className="flex flex-wrap gap-2">
            {itemSets.data?.map((s) => {
              const on = setOnOrder(s, order.lines)
              return (
                <Button key={s.id} size="sm" variant={on ? 'secondary' : 'outline'} disabled={!order.employee || busy} onClick={() => applySet(s)}>
                  {on ? <Check aria-hidden /> : <Plus aria-hidden />}
                  <span className="sr-only">{t.order.applySr}</span>
                  {s.name}
                  {on ? <span className="sr-only">{t.order.onThisOrderSr}</span> : null}
                </Button>
              )
            })}
            {itemSets.data?.length === 0 ? <p className="text-sm text-muted-foreground">{t.order.noItemSets}</p> : null}
          </div>
        </div>
      </section>

      {!order.employee ? (
        <p className="mb-4 text-sm text-muted-foreground">{t.order.chooseEmployeeFirst}</p>
      ) : null}

      {order.employee && dueNow.length > 0 ? (
        <section aria-labelledby="due-now" className="mb-4 rounded-lg border border-border bg-muted/40 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 id="due-now" className="text-sm font-semibold">
              {t.order.dueFor(order.employee.first_name)}
            </h2>
            {dueNow.length > 1 ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => addItems(dueNow.map((d) => ({ item: d.item, quantity: d.due.item.quantity })))}>
                {t.order.addAll(dueNow.length)}
              </Button>
            ) : null}
          </div>
          <ul className="flex flex-col gap-2">
            {dueNow.map(({ due, item }) => (
              <li key={item.id} className="flex items-center gap-3">
                <ItemTile icon={item.icon} className="size-8" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{item.name}</span> × {due.item.quantity}
                  <span className={cn('block text-xs', due.overdue ? 'text-destructive' : 'text-muted-foreground')}>
                    {(due.overdue ? t.order.overdueSinceLastGiven : t.order.dueLastGiven)(formatDate(due.dueAt.toISOString(), tz), formatDate(due.item.at, tz))}
                  </span>
                </span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => addItems([{ item, quantity: due.item.quantity }])}>
                  <Plus aria-hidden /> {t.common.add}<span className="sr-only"> {item.name}</span>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {conflicts.length > 0 ? (
        <Alert className="mb-4">
          <AlertTitle>{t.order.checkSizesFor(order.employee?.full_name ?? '')}</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 flex flex-col gap-2">
              {conflicts.map((c) => (
                <li key={c.catalogueItemId} className="flex flex-wrap items-center gap-2">
                  <span>
                    {nodes(
                      c.resolvedSize
                        ? t.order.conflictResolved(c.itemName, <strong>{c.manualSize}</strong>, <strong>{c.resolvedSize}</strong>)
                        : t.order.conflictNoSaved(c.itemName, <strong>{c.manualSize}</strong>),
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
                    {c.resolvedSize ? t.order.useSize(c.resolvedSize) : t.order.clearSize}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setOrder((o) => removeLine(o, c.catalogueItemId))
                      setConflicts((cs) => cs.filter((x) => x !== c))
                    }}
                  >
                    {t.order.removeLine}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConflicts((cs) => cs.filter((x) => x !== c))}>
                    {t.order.keepSize(c.manualSize)}
                  </Button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {pendingDefault && order.employee ? (
        <Alert className="mb-4">
          <AlertTitle>{t.order.saveAsDefaultQuestion}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {nodes(
                (pendingDefault.group === 'CLOTHING' ? t.order.noSavedClothing : t.order.noSavedShoe)(
                  order.employee.full_name,
                  <strong>{pendingDefault.size}</strong>,
                ),
              )}
            </span>
            <Button size="sm" onClick={() => saveDefault(pendingDefault)} disabled={busy}>
              {t.order.saveAsDefault}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingDefault(null)}>
              {t.order.thisOrderOnly}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {!catalogue.data && !loadError ? (
        <Loading />
      ) : (
        <LinesTable
          order={order}
          sizes={sizes.data}
          icons={new Map(catalogue.data?.map((i) => [i.id, i.icon]))}
          problems={v.lineProblems}
          onSize={chooseSize}
          onChange={setOrder}
        />
      )}

      {!v.valid && order.lines.length > 0 ? (
        <ul className="mt-4 list-disc pl-5 text-sm text-muted-foreground">
          {v.orderProblems.map((p) => (
            <li key={p}>{p}</li>
          ))}
          {v.lineProblems.size > 0 ? <li>{t.order.resolveHighlighted}</li> : null}
        </ul>
      ) : null}

      </div>

      <OrderSummary
        order={order}
        valid={v.valid}
        busy={busy}
        due={dueAll}
        onThisOrder={onThisOrder}
        last={last}
        tz={tz}
        whatsappText={whatsappText}
        navigate={navigate}
        onReview={() => setReviewing(true)}
      />
      </div>
      </div>

      <ReviewSheet
        open={reviewing}
        order={order}
        busy={busy}
        whatsappText={whatsappText}
        createLink={createLink}
        onCreateLink={(on) => {
          setCreateLink(on)
          saveCreateLink(on)
        }}
        onClose={() => setReviewing(false)}
        onConfirm={() => {
          // A failure shows on the page, with Retry, and keeps the order.
          setReviewing(false)
          void markAsOrdered(createLink)
        }}
      />

      <EmployeeForm
        open={addingEmployee}
        sizes={sizes.data}
        submitLabel={t.order.saveAndSelectEmployee}
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
 * What the order comes to, and the way on to the review. Narrow, it is a bar
 * pinned above the phone tab bar holding one Review button with the line count
 * and total. Where the composer has room (composer-wide) it is a sticky panel
 * beside the lines: who the order is for and their last order, what they are
 * due, the lines and total, Review, Copy for WhatsApp, and the keyboard keys.
 */
function OrderSummary({
  order,
  valid,
  busy,
  due,
  onThisOrder,
  last,
  tz,
  whatsappText,
  navigate,
  onReview,
}: {
  order: WorkingOrder
  valid: boolean
  busy: boolean
  due: DueItem[]
  onThisOrder: Set<string>
  last: ListedOrder | undefined
  tz: string
  whatsappText: string
  navigate: (to: Route) => void
  onReview: () => void
}) {
  const n = order.lines.length
  const total = formatEuro(totalCents(order))
  const state = valid ? ` · ${t.order.complete}` : n > 0 ? ` · ${t.order.notReady}` : ''
  const e = order.employee
  return (
    <aside
      aria-label={t.order.orderSummary}
      className={cn(
        'sticky bottom-[var(--bottom-nav)] z-20 mt-4 border-t border-border bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        '-mx-4 px-4 md:-mx-6 md:px-6 xl:-mx-10 xl:px-10 print:hidden',
        'composer-wide:top-6 composer-wide:bottom-auto composer-wide:mx-0 composer-wide:mt-0 composer-wide:flex composer-wide:flex-col composer-wide:gap-4 composer-wide:rounded-lg composer-wide:border composer-wide:bg-card composer-wide:p-4 composer-wide:backdrop-blur-none',
      )}
    >
      {/* Narrow: one button, the count and the total on it. */}
      <Button size="lg" className="w-full justify-between composer-wide:hidden" disabled={!valid || busy} onClick={onReview}>
        <span>{busy ? t.order.working : t.order.review}</span>{' '}
        <span className="font-normal opacity-80">
          {linesText(n)}
          {state}
        </span>{' '}
        <span className="tabular-nums">{total}</span>
      </Button>

      {/* Wide: the panel. */}
      <div className="hidden text-sm composer-wide:flex composer-wide:flex-col composer-wide:gap-3">
        {e ? (
          <div>
            <p className="text-xs text-muted-foreground">{t.order.for}</p>
            <p className="font-medium">
              {e.full_name}
              {e.code ? <span className="font-normal text-muted-foreground"> · {e.code}</span> : null}
            </p>
            {last ? (
              <p className="text-xs text-muted-foreground">
                {t.order.lastOrder}{' '}
                <a {...linkTo({ name: 'history', order: last.id }, navigate)} className="font-medium text-foreground underline-offset-4 hover:underline">
                  {last.record_number}
                </a>{' '}
                · {formatDate(last.ordered_at, tz)} · {last.status === 'GIVEN' ? t.common.given : t.common.ordered}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t.order.noEarlierOrders}</p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">{t.order.chooseEmployee}</p>
        )}
        {due.length > 0 ? (
          <ul aria-label={t.order.dueForReplacement} className="flex flex-col gap-1 border-t border-border pt-3 text-xs">
            {due.slice(0, 4).map(({ due: d, item }) => (
              <li key={item.id} className="flex items-start gap-1.5">
                {onThisOrder.has(item.id) ? <Check aria-hidden className="mt-px size-3.5 shrink-0 text-primary" /> : <span aria-hidden className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', d.overdue ? 'bg-destructive' : 'bg-muted-foreground')} />}
                <span>
                  {(d.overdue ? t.order.itemOverdueSince : t.order.itemDue)(item.name, formatDate(d.dueAt.toISOString(), tz))}
                  {onThisOrder.has(item.id) ? <span className="text-muted-foreground"> · {t.order.onThisOrder}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
          <span className="text-muted-foreground">
            {linesText(n)}
            {state}
          </span>
          <span className="text-lg font-semibold tabular-nums">{total}</span>
        </div>
        <Button disabled={!valid || busy} onClick={onReview}>
          {busy ? t.order.working : t.order.reviewAndMark}
        </Button>
        <WhatsAppButton disabled={!valid || busy} text={whatsappText} />
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground pointer-coarse:hidden">
          <span>
            <kbd className="rounded border border-border px-1 font-mono">/</kbd> {t.order.keyAddItem}
          </span>
          <span>
            <kbd className="rounded border border-border px-1 font-mono">⌘/Ctrl ↵</kbd> {t.order.keyReview}
          </span>
          <span>
            <kbd className="rounded border border-border px-1 font-mono">↑↓</kbd> {t.order.keyQuantity}
          </span>
        </p>
      </div>
    </aside>
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
  whatsappText,
  createLink,
  onCreateLink,
  onClose,
  onConfirm,
}: {
  open: boolean
  order: WorkingOrder
  busy: boolean
  /** The order as a message to the supplier, before it is marked as ordered. */
  whatsappText: string
  createLink: boolean
  onCreateLink: (on: boolean) => void
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.order.reviewOrder}
      description={t.order.reviewDescription(`${order.employee?.full_name ?? '—'}${order.employee?.code ? ` · ${order.employee.code}` : ''}`)}
      footer={
        <>
          <WhatsAppButton className="sm:mr-auto" disabled={busy} text={whatsappText} />
          <Button disabled={busy} onClick={onConfirm}>
            {t.order.markAsOrdered}
          </Button>
        </>
      }
    >
      <ul aria-label={t.order.orderLines} className="flex flex-col divide-y divide-border text-sm">
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
        <span>{t.common.total}</span>
        <span className="text-base tabular-nums">{formatEuro(totalCents(order))}</span>
      </p>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-md p-1 text-sm">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={createLink} onChange={(e) => onCreateLink(e.target.checked)} />
        <span>
          {t.order.createLinkToo}
          <span className="block text-xs text-muted-foreground">
            {t.order.createLinkHint(order.employee?.first_name ?? null)}
          </span>
        </span>
      </label>
    </FormSheet>
  )
}

/**
 * Shown after Mark as Ordered: the stored, now immutable record, built only
 * from the server's snapshot, and the next step: the employee confirms receipt
 * by a secure link or on the printed record.
 */
function OrderedPanel({ placed, navigate, onNew }: { placed: Placed; navigate: (to: Route) => void; onNew: () => void }) {
  const { order, link } = placed
  const [confirming, setConfirming] = useState(false)
  const [given, setGiven] = useState(false)
  const name = `${order.employee_first_name} ${order.employee_last_name}`
  return (
    <>
      <PageHeader title={t.order.title} />
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <CheckCircle2 aria-hidden className="size-5 text-primary" />
            {t.order.orderIsOrdered(order.record_number)}
            {given ? <Badge>{t.common.given}</Badge> : <Badge variant="secondary">{t.common.ordered}</Badge>}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {name}
            {order.employee_code ? ` · ${order.employee_code}` : ''} · {t.order.preparedBy(order.prepared_by_name)} ·{' '}
            {new Date(order.ordered_at).toLocaleString(intlLocale())}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <OrderLinesTable order={order} />
          <p className="text-sm text-muted-foreground">
            {given
              ? t.order.nextGiven(name)
              : link
                ? t.order.nextSendLink(name)
                : t.order.nextConfirm(name)}
          </p>
          {link && !given ? (
            <section aria-label={t.order.employeeConfirmation} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <ConfirmationLinkView link={link} name={name} recordNumber={order.record_number} />
            </section>
          ) : null}
          {placed.linkError && !given ? (
            <ErrorState title={t.order.linkNotCreated} error={placed.linkError} />
          ) : null}
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-start">
            {given || link ? null : (
              <Button className="w-full sm:w-auto" onClick={() => setConfirming(true)}>
                <LinkIcon aria-hidden /> {t.order.sendConfirmationLink}
              </Button>
            )}
            <WhatsAppButton className="w-full sm:w-auto" text={formatWhatsApp(messageFromOrder(order))} />
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate({ name: 'record', id: order.id, print: true })}>
              <Printer aria-hidden /> {t.order.printRecord}
            </Button>
            <Button variant="outline" className="w-full sm:w-auto" onClick={onNew}>
              {t.order.startNewOrder}
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

/** A translated sentence with emphasised values in it (t.order.conflictResolved), as siblings. */
function nodes(parts: ReactNode[]): ReactNode {
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)
}

/** Quantities sent for resolution must be valid; an invalid typed value resolves as 1 and stays flagged locally. */
function validQty(q: number): number {
  return Number.isInteger(q) && q >= 1 ? q : 1
}

function LinesTable({
  order,
  sizes,
  icons,
  problems,
  onSize,
  onChange,
}: {
  order: WorkingOrder
  sizes: Sizes | undefined
  /** Pictograms by catalogue item, from the active catalogue. */
  icons: Map<string, CatalogueIcon>
  problems: Map<string, string[]>
  onSize: (l: WorkingLine, size: string | null) => void
  onChange: (f: (o: WorkingOrder) => WorkingOrder) => void
}) {
  if (order.lines.length === 0) {
    return <EmptyState>{t.order.noItemsYet}</EmptyState>
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
          <TableHead>{t.order.item}</TableHead>
          <TableHead>{t.order.size}</TableHead>
          <TableHead>{t.order.quantity}</TableHead>
          <TableHead className="text-right">{t.order.unitPrice}</TableHead>
          <TableHead>{t.order.servicePeriod}</TableHead>
          <TableHead className="text-right">{t.common.total}</TableHead>
          <TableHead className="w-10">
            <span className="sr-only">{t.order.remove}</span>
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
                <div className="flex items-start gap-3">
                  <ItemTile icon={icons.get(l.catalogueItemId)} className="max-sm:hidden" />
                  <div className="min-w-0">
                    <div className="font-medium">{l.itemName || t.order.unknownItem}</div>
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
                  </div>
                </div>
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
                <Button size="icon-sm" variant="ghost" aria-label={t.order.removeItem(l.itemName)} onClick={() => onChange((o) => removeLine(o, l.catalogueItemId))}>
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
            {t.order.totalValue}
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
      <span aria-label={t.order.noSize} className="flex h-9 items-center text-muted-foreground pointer-coarse:h-11 stacked:px-2">
        –
      </span>
    )
  const clothing = line.sizeGroup === 'CLOTHING'
  const bands = clothingBands(sizes?.clothing ?? [])
  const options = clothing ? bands : (sizes?.shoes ?? []).map((s) => ({ value: s.code, label: s.code }))
  const missing = line.size === null
  return (
    <div className="flex flex-col gap-1">
      <Select
        aria-label={t.order.sizeOf(line.itemName)}
        className="h-9 w-40 pointer-coarse:h-11 stacked:w-auto stacked:max-w-40"
        invalid={missing}
        value={clothing ? clothingBandValue(bands, line.size) : (line.size ?? '')}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{t.order.selectSizeOption}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {line.sizeSource === 'suggested' ? (
        <Badge variant="outline" className="w-fit">
          {t.order.suggestedFromHeight}
        </Badge>
      ) : null}
    </div>
  )
}
