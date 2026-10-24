import { ApiError, type Employee } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { DropdownMenuItem, DropdownMenuSeparator } from '@ppe/ui/components/dropdown-menu'
import { Field, Select, controlProps } from '@ppe/ui/components/field'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { SortControl, SortableHead } from '@ppe/ui/components/sortable'
import { ActionError, Loaded } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@ppe/ui/components/table'
import { InControl } from '@ppe/ui/components/tooltip'
import { type SortColumn, type SortState, sortRows } from '@ppe/ui/lib/sort'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { FileText, Pencil, Plus, RotateCcw } from 'lucide-react'
import { type FormEvent, useMemo, useRef, useState } from 'react'

import { OrderStatusBadge } from '@/components/order-status'
import { formatDate } from '@/components/dashboard'
import { EmployeeForm } from '@/components/employee-form'
import { HeldAssets } from '@/components/held-assets'
import { RecordPreview } from '@/components/record-preview'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { linkVariants } from '@ppe/ui/components/link'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { useAction } from '@ppe/ui/lib/use-action'
import { RecordHeader, RecordTitle } from '@ppe/ui/components/record-header'
import { PaneBar } from '@ppe/ui/components/list-detail'
import { isLang, languages, t } from '@/i18n'
import { type Due, type EmployeeItem, employeeItems, loadAllOrders, replacementsDue } from '@/lib/employee-items'
import { formatUsage } from '@/lib/history'
import { missingSizes } from '@/lib/missing-sizes'
import { useOpenKey } from '@/lib/open-sections'
import { type Route, linkTo } from '@/lib/router'
import { sizeRank } from '@/lib/sort'
import { clothingBands, clothingSizeLabel, formatMonths, formatSize } from '@/lib/utils'

import { MissingBadge, type SizeField, SizeFields, useSizesDraft } from './employees'

/**
 * One employee (/employees/<id>): details and size defaults, the items given
 * to them with a link to each receipt and when each is due for replacement,
 * and items ordered but not yet given. Items come from order snapshots, so
 * they show what was actually issued. New order and Reorder start Create
 * Order for them; Edit details and Delete are under ⋯. Changes lists who
 * changed their details and sizes, and when.
 */
export function EmployeePage({
  id,
  navigate,
  onClose,
  onChanged,
}: {
  id: string
  navigate: (to: Route) => void
  /** Back to the list, or Close beside it. */
  onClose: () => void
  /** Her name, code or sizes changed, or she was deleted: the list shows them too. */
  onChanged: () => void
}) {
  const { client } = useApi()
  const session = useSession()
  const employee = useLoad(() => client.employees.get(id), [id])
  const orders = useLoad(() => loadAllOrders(client, { employee_id: id }), [id])
  const settings = useLoad(() => client.settings())
  const sizes = useLoad(() => client.sizes())
  const [editing, setEditing] = useState(false)
  const action = useAction()
  const givenKey = useOpenKey('employee.items-given')
  const orderedKey = useOpenKey('employee.items-ordered')
  const changesKey = useOpenKey('employee.changes')
  // The card's Edit buttons turn its sizes, or the preferred language, into their fields in
  // place, one at a time. Closing gives focus back to the Edit the form hid.
  const [inPlace, setInPlace] = useState<'sizes' | 'language' | null>(null)
  const sizing = inPlace === 'sizes'
  const [focusField, setFocusField] = useState<SizeField>('height')
  const editSizesButton = useRef<HTMLButtonElement>(null)
  const editLanguageButton = useRef<HTMLButtonElement>(null)
  const openSizes = (field: SizeField) => {
    setFocusField(field)
    setInPlace('sizes')
  }
  const closeInPlace = () => {
    const button = inPlace === 'language' ? editLanguageButton : editSizesButton
    setInPlace(null)
    requestAnimationFrame(() => button.current?.focus())
  }
  const draft = useSizesDraft(sizing ? (employee.data ?? null) : null, () => {
    closeInPlace()
    employee.reload()
    onChanged()
  })
  const [language, setLanguage] = useState('')
  const [languageError, setLanguageError] = useState<string>()
  const openLanguage = (emp: Employee) => {
    setLanguage(emp.preferred_language ?? '')
    setLanguageError(undefined)
    setInPlace('language')
  }
  // The language is one of the employee's details, saved with the rest of them as they are.
  const saveLanguage = async (ev: FormEvent, emp: Employee) => {
    ev.preventDefault()
    const { first_name, last_name, code, height_cm, clothing_size, shoe_size, notes } = emp
    try {
      await client.employees.update(emp.id, {
        first_name,
        last_name,
        code,
        height_cm,
        clothing_size,
        shoe_size,
        notes,
        preferred_language: isLang(language) ? language : null,
      })
      closeInPlace()
      employee.reload()
    } catch (err) {
      setLanguageError(errorText(err))
    }
  }

  const items = useMemo(() => employeeItems(orders.data ?? []), [orders.data])
  const due = useMemo(() => replacementsDue(orders.data ?? [], new Date()), [orders.data])
  // What a Reorder would order: due within 30 days (or overdue) and not on an order already.
  const reorder = due.filter((d) => d.dueSoon && !d.reordered)
  const dueByLine = useMemo(() => new Map(due.map((d) => [d.item.key, d])), [due])
  const tz = settings.data?.timezone
  const e = employee.data
  const missing = e ? missingSizes(e) : { clothing: false, shoes: false }

  // Delete is here and under ⋯ in the table, never on a list row a phone scrolls past.
  const remove = (emp: Employee) =>
    action.run(
      async () => {
        await client.employees.remove(emp.id)
        onChanged()
        onClose()
      },
      {
        confirm: t.employees.confirmDelete(emp.full_name),
        // Leaving never returns company assets (assets brief §2): the API names the ones still held.
        mapError: (err) => {
          const held = err instanceof ApiError && err.isConflict ? /holds company assets: (.+)$/.exec(err.message) : null
          return held?.[1] ? new Error(t.assets.holdsAssets(held[1])) : err
        },
      },
    )

  return (
    <>
      <PaneBar backLabel={t.employees.title} closeLabel={t.employees.closeEmployee} onClose={onClose} className="mb-2" />
      <Loaded load={employee}>
        {(e) => (
          <>
            <RecordHeader
              className="mb-5"
              title={<RecordTitle>{e.full_name}</RecordTitle>}
              actions={
                <>
                  <Button onClick={() => navigate({ name: 'createOrder', prefill: { employeeId: e.id, items: [] } })}>
                    <Plus aria-hidden /> {t.employees.newOrder}
                  </Button>
                  <MoreActions label={t.common.moreActions(e.full_name)}>
                    <DropdownMenuItem onClick={() => setEditing(true)}>{t.employees.editDetails}</DropdownMenuItem>
                    {session.can('employees.delete') ? (
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
            >
              {e.code ? <p className="mt-1 text-sm text-muted-foreground">{t.employees.codeIs(e.code)}</p> : null}
            </RecordHeader>
            {/* Sizes are what Create Order resolves from, so they are edited here, in place: the values become their fields. */}
            {/* Flat, between two rules, as a pane's facts; while one part is edited in place, its rules are the focus colour. */}
            <div className={cn('mb-6 border-y border-border text-sm transition-colors sm:max-w-2xl', inPlace && 'border-ring')}>
              <section aria-labelledby="sizes-heading">
                <div className="flex min-h-12 items-center justify-between gap-3 pt-2">
                  <h2 id="sizes-heading" className="font-semibold">
                    {t.employees.sizes}
                  </h2>
                  {sizing ? (
                    <p className="text-muted-foreground">{t.employees.futureOnly}</p>
                  ) : (
                    <Button ref={editSizesButton} size="sm" variant="outline" aria-label={t.employees.editSizes} onClick={() => openSizes('height')}>
                      <Pencil aria-hidden /> {t.common.edit}
                    </Button>
                  )}
                </div>
                {sizing ? (
                  <form
                    aria-label={t.employees.editSizesTitle(e.full_name)}
                    onSubmit={draft.submit}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Escape') {
                        ev.preventDefault()
                        closeInPlace()
                      }
                    }}
                    className="grid gap-3 pt-2 pb-4 sm:grid-cols-3 sm:gap-4"
                  >
                    <SizeFields draft={draft} sizes={sizes.data} autoFocus={focusField} />
                    {draft.error ? (
                      <p role="alert" className="col-span-full text-destructive">
                        {draft.error}
                      </p>
                    ) : null}
                    <div className="col-span-full flex justify-end gap-2">
                      <Button type="button" variant="outline" onClick={closeInPlace}>
                        {t.common.cancel}
                      </Button>
                      <Button type="submit" disabled={draft.busy}>
                        {draft.busy ? t.common.saving : t.common.save}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <FactGrid ruled={false} className="grid-cols-3 pt-2 pb-4">
                    {/* As in the list: grey when a saved clothing size makes the height unnecessary. A missing size opens its field. */}
                    <Fact label={t.employees.height}>
                      {e.height_cm ? (
                        t.employees.heightCm(e.height_cm)
                      ) : (
                        <SetMissing label={t.employees.height} optional={!missing.clothing} onClick={() => openSizes('height')} />
                      )}
                    </Fact>
                    <Fact label={t.employees.clothing}>
                      {missing.clothing ? (
                        <SetMissing label={t.employees.clothing} onClick={() => openSizes('clothing')} />
                      ) : (
                        clothingSizeLabel(clothingBands(sizes.data?.clothing ?? []), e.clothing_size)
                      )}
                    </Fact>
                    <Fact label={t.employees.shoes}>
                      {missing.shoes ? <SetMissing label={t.employees.shoes} onClick={() => openSizes('shoe')} /> : formatSize(e.shoe_size)}
                    </Fact>
                  </FactGrid>
                )}
              </section>
              <div className="grid gap-4 border-t border-border py-4">
                {inPlace === 'language' ? (
                  <form
                    aria-label={t.employees.editLanguage}
                    onSubmit={(ev) => void saveLanguage(ev, e)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Escape') {
                        ev.preventDefault()
                        closeInPlace()
                      }
                    }}
                    className="grid gap-4 sm:grid-cols-3 sm:items-end"
                  >
                    <Field label={t.employees.preferredLanguage}>
                      {(p) => (
                        // Each language named in itself, as on Account.
                        <Select {...controlProps(p)} autoFocus value={language} onChange={(ev) => setLanguage(ev.target.value)}>
                          <option value="">{t.employees.notSet}</option>
                          {languages.map((l) => (
                            <option key={l.value} value={l.value} lang={l.value}>
                              {l.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <div className="flex justify-end gap-2 sm:col-span-2">
                      <Button type="button" variant="outline" onClick={closeInPlace}>
                        {t.common.cancel}
                      </Button>
                      <Button type="submit">{t.common.save}</Button>
                    </div>
                    {languageError ? (
                      <p role="alert" className="col-span-full text-destructive">
                        {languageError}
                      </p>
                    ) : null}
                  </form>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <dl>
                      <Fact label={t.employees.preferredLanguage}>
                        <span lang={e.preferred_language ?? undefined}>{languages.find((l) => l.value === e.preferred_language)?.label ?? '–'}</span>
                      </Fact>
                    </dl>
                    <Button ref={editLanguageButton} size="sm" variant="outline" aria-label={t.employees.editLanguage} onClick={() => openLanguage(e)}>
                      <Pencil aria-hidden /> {t.common.edit}
                    </Button>
                  </div>
                )}
                {e.notes ? (
                  <dl>
                    <dt className="text-muted-foreground">{t.employees.notes}</dt>
                    <dd className="mt-0.5 whitespace-pre-line">{e.notes}</dd>
                  </dl>
                ) : null}
              </div>
            </div>

            {reorder.length > 0 ? (
              // A ruled callout, not a box: what is due, and Reorder beside it.
              <section aria-labelledby="due-heading" className="mb-6 flex flex-wrap items-center justify-between gap-3 border-y border-border py-3 text-sm sm:max-w-2xl">
                <div className="flex min-w-0 items-start gap-3">
                  <RotateCcw aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div className="min-w-0">
                    <h2 id="due-heading" className="font-medium">
                      {t.employees.dueForReplacement(reorder.length)}
                    </h2>
                    <p className="text-muted-foreground">
                      {reorder
                        .map((d) =>
                          d.overdue ? t.employees.dueItemOverdue(d.item.itemName) : t.employees.dueItemOn(d.item.itemName, formatDate(d.dueAt.toISOString(), tz ?? 'UTC')),
                        )
                        .join(', ')}
                    </p>
                  </div>
                </div>
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
              </section>
            ) : null}
            <ActionError error={action.error} />

            {/* Closed at first, as Changes are; the counts say what each holds, the title's tooltip what it is. */}
            <DisclosureSection
              id="items-given"
              title={t.employees.itemsGiven}
              count={orders.data ? items.given.length : undefined}
              description={`${t.employees.itemsGivenHint}${tz ? ` ${t.employees.datesIn(tz)}` : ''}`}
              rememberAs={givenKey}
            >
              <Loaded load={orders} empty={items.given.length === 0} emptyState={t.employees.noItemsGiven(e.first_name)}>
                {() => (
                  <ItemsTable items={items.given} kind="given" tz={tz} due={dueByLine} navigate={navigate} />
                )}
              </Loaded>
            </DisclosureSection>

            {items.ordered.length > 0 ? (
              <DisclosureSection id="items-ordered" title={t.employees.orderedNotGiven} count={items.ordered.length} description={t.employees.waitingForReceipt} rememberAs={orderedKey}>
                <ItemsTable items={items.ordered} kind="ordered" tz={tz} navigate={navigate} />
              </DisclosureSection>
            ) : null}

            <HeldAssets
              kind="SIM"
              employee={{ id: e.id, full_name: e.full_name, code: e.code }}
              timeZone={tz}
              defaultPlan={settings.data?.default_sim_plan}
              navigate={navigate}
            />
            {session.can('equipment.read') ? (
              <HeldAssets kind="EQUIPMENT" employee={{ id: e.id, full_name: e.full_name, code: e.code }} timeZone={tz} navigate={navigate} />
            ) : null}

            <RecordChanges load={() => client.audit.history('employees', id)} deps={[id, e.updated_at]} timeZone={tz} rememberAs={changesKey} className="mb-0" />

            <EmployeeForm
              open={editing}
              employee={e}
              sizes={sizes.data}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false)
                employee.reload()
                onChanged()
              }}
            />
          </>
        )}
      </Loaded>
    </>
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
    { key: 'item', label: t.employees.item, kind: 'text' },
    { key: 'size', label: t.employees.size, kind: 'size' },
    { key: 'quantity', label: t.employees.quantity, kind: 'number' },
    { key: 'date', label: dateLabel, firstDir: 'desc', kind: 'date' },
    ...(given ? [{ key: 'usage' as const, label: t.employees.usageTime, kind: 'duration' as const }] : []),
    { key: 'period', label: t.employees.servicePeriod, kind: 'duration' },
    ...(due ? [{ key: 'due' as const, label: t.employees.replacement, kind: 'date' as const }] : []),
    { key: 'record', label: given ? t.employees.receipt : t.employees.record, kind: 'number' },
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
              <TableCell label={t.employees.usageTime} className="stacked:order-2">{formatUsage(i.usageMonths) || '–'}</TableCell>
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
                  className={linkVariants({ underline: 'always', weight: 'medium', className: 'inline-flex min-h-11 items-center gap-1.5 md:min-h-0' })}
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
                    className={linkVariants({ className: 'inline-flex min-h-11 items-center md:min-h-0' })}
                  >
                    {i.recordNumber}
                  </RecordPreview>
                  <OrderStatusBadge status="ORDERED" />
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

/** A missing size: its badge, which opens Edit Sizes at that size's field. */
function SetMissing({ label, optional = false, onClick }: { label: string; optional?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${t.employees.editSizes}: ${label}`}
      onClick={onClick}
      className="-m-1 inline-flex rounded-md p-1 outline-none hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-11 pointer-coarse:items-center"
    >
      {/* The button takes the click: the badge inside is a tooltip, not a button of its own. */}
      <InControl value>
        <MissingBadge optional={optional} />
      </InControl>
    </button>
  )
}
