import type { Supplier } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { Field, Input, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { SortMenu, SortableHead } from '@ppe/ui/components/sortable'
import { ActionError, EmptyState, Loaded, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { type SortColumn, type SortState, newestFirst, sortRows } from '@ppe/ui/lib/sort'
import { useAction } from '@ppe/ui/lib/use-action'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { EXPORT_MODE, ExportMode } from '@ppe/ui/components/export-mode'
import { RowCheckbox, SelectAllCheckbox, selectCellClass, selectRowClass } from '@ppe/ui/components/selection-bar'
import { selectRowProps, useSelection } from '@ppe/ui/lib/use-selection'
import { cn } from '@ppe/ui/lib/utils'
import { Download, Plus } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'

import { t } from '@/i18n'
import { supplierExportColumns } from '@/lib/list-export'
import type { Route } from '@/lib/router'
import { type SupplierDraft, type SupplierErrors, draftOf, matches, placeOf, toInput, validateSupplier } from '@/lib/suppliers'

/** A row's key in the selection; a module constant, so the hook's memos hold. */
const supplierId = (s: Supplier) => s.id

type SupplierSort = 'code' | 'name' | 'place' | 'items'

const columns = (): SortColumn<SupplierSort>[] => [
  { key: 'code', label: t.suppliers.code, kind: 'text' },
  { key: 'name', label: t.suppliers.name, kind: 'text' },
  { key: 'place', label: t.suppliers.place, kind: 'text' },
  { key: 'items', label: t.suppliers.items, kind: 'number' },
]

/**
 * Suppliers: the companies catalogue items are bought from, each with an
 * internal code and its company details. An item's supplier is chosen on the
 * staff app's Edit Item; deleting a supplier leaves its items with none.
 */
export function SuppliersPage({ navigate }: { navigate: (to: Route) => void }) {
  const { client } = useApi()
  const session = useSession()
  const canExport = session.can('data.export')
  const allowed = session.can('suppliers.manage')
  const list = useLoad(() => (allowed ? client.suppliers.list() : Promise.resolve([])))
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  // What the last save or delete did, as a status line (a screen reader hears it too).
  const [saved, setSaved] = useState('')
  const action = useAction()
  // Newest first until a column is sorted (WARE-55); a third click on it returns there.
  const [sort, setSort] = useState<SortState<SupplierSort> | null>(null)
  const sortProps = { sort, onSort: setSort, allowNone: true }

  const shown = useMemo(
    () =>
      sortRows(
        newestFirst((list.data ?? []).filter((s) => matches(s, filter))),
        sort,
        (s, key) => (key === 'place' ? placeOf(s) : key === 'items' ? s.item_count : s[key]),
      ),
    [list.data, filter, sort],
  )
  // The suppliers ticked for Export: only those the search shows count.
  const selection = useSelection(shown, supplierId)

  if (!allowed) {
    return (
      <>
        <PageHeader title={t.suppliers.title} />
        <EmptyState>{t.suppliers.onlyManagers}</EmptyState>
      </>
    )
  }

  const remove = async (s: Supplier) => {
    const done = await action.run(() => client.suppliers.remove(s.id), { confirm: t.suppliers.deleteQuestion(s.name, s.item_count) })
    if (done) {
      setSaved(t.suppliers.deleted(s.name))
      list.reload()
    }
  }

  return (
    <>
      <PageHeader
        title={t.suppliers.title}
        description={t.suppliers.description}
        // Export: in the header from md, in ⋯ below; it starts select mode (WARE-45), on a phone too.
        secondary={canExport ? [{ label: t.common.export, icon: Download, onClick: () => selection.start(EXPORT_MODE), showFrom: 'md', disabled: shown.length === 0 || selection.active }] : []}
        primary={{ label: t.suppliers.addSupplier, short: t.common.add, icon: Plus, onClick: () => setEditing('new') }}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          type="search"
          enterKeyHint="search"
          placeholder={t.suppliers.searchPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t.suppliers.searchLabel}
          data-shortcut="search"
          className="min-w-0 flex-1 md:max-w-sm"
        />
      </div>
      <ActionError error={action.error} className="mb-4" />
      <p role="status" className="mb-3 text-sm text-muted-foreground empty:hidden">
        {saved}
      </p>
      {/* Export starts select mode (WARE-45): its bar, the checkboxes, then the sheet. */}
      {canExport ? <ExportMode selection={selection} list={t.suppliers.title} columns={supplierExportColumns()} shown={shown} /> : null}
      <Loaded load={list} empty={shown.length === 0} emptyState={filter.trim() ? t.suppliers.noMatch(filter.trim()) : t.suppliers.noSuppliers}>
        {() => (
          // Where the table is narrow the suppliers are one list of rows: name, then code and place, with Edit and ⋯ beside them.
          <Table stack="list" stickyHead sortControl={<SortMenu columns={columns()} {...sortProps} />}>
            <TableHeader>
              <TableRow>
                {/* The checkboxes are there only in select mode (WARE-45). */}
                {selection.active ? (
                  <TableHead className={selectCellClass}>
                    <SelectAllCheckbox selection={selection} />
                  </TableHead>
                ) : null}
                {columns().map((c) => (
                  <SortableHead key={c.key} column={c} {...sortProps} />
                ))}
                <TableHead>{t.suppliers.contact}</TableHead>
                <TableHead className="text-right">{t.suppliers.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((s) => (
                <TableRow key={s.id} {...selectRowProps(selection, s.id)} className={cn('stacked:grid stacked:grid-cols-[minmax(0,1fr)_auto] stacked:gap-x-3', selectRowClass(selection, s.id))}>
                  {selection.active ? (
                    <TableCell className={selectCellClass}>
                      <RowCheckbox selection={selection} id={s.id} name={s.name} />
                    </TableCell>
                  ) : null}
                  <TableCell className="font-mono text-sm stacked:col-start-1 stacked:row-start-2 stacked:text-xs stacked:text-muted-foreground">{s.code}</TableCell>
                  <TableCell className="font-medium whitespace-normal stacked:col-start-1 stacked:row-start-1">{s.name}</TableCell>
                  <TableCell className="stacked:col-start-1 stacked:row-start-3 stacked:text-xs stacked:text-muted-foreground">{placeOf(s)}</TableCell>
                  <TableCell className="tabular-nums stacked:hidden">{s.item_count}</TableCell>
                  <TableCell className="break-all whitespace-normal stacked:hidden">
                    {s.contact_person ? <span className="block">{s.contact_person}</span> : null}
                    {s.email ? <span className="block text-muted-foreground">{s.email}</span> : null}
                    {s.phone ? <span className="block text-muted-foreground">{s.phone}</span> : null}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap stacked:col-start-2 stacked:flex stacked:[grid-row:1/span_3] stacked:items-center stacked:gap-1">
                    {/* In select mode the row's own actions step aside: a click ticks the row. */}
                    {selection.active ? null : (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setEditing(s)} aria-label={t.suppliers.editLabel(s.name)}>
                          {t.common.edit}
                        </Button>{' '}
                        <MoreActions label={t.common.moreActions(s.name)}>
                          {session.can('audit.read') ? (
                            <DropdownMenuItem onClick={() => navigate({ name: 'audit', filter: { entity_type: 'supplier', entity_id: s.id } })}>
                              {t.suppliers.changes}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem variant="destructive" onClick={() => void remove(s)}>
                            {t.suppliers.deleteSupplier}
                          </DropdownMenuItem>
                        </MoreActions>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Loaded>
      <SupplierForm
        open={editing !== null}
        supplier={editing === 'new' || editing === null ? undefined : editing}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null)
          setSaved(message)
          list.reload()
        }}
      />
    </>
  )
}

/** A group of the form's fields under a heading, across both columns. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

/** Add Supplier or Edit Supplier: the company, its address and contact, its bank account and notes. */
function SupplierForm({
  open,
  supplier,
  onClose,
  onSaved,
}: {
  open: boolean
  supplier: Supplier | undefined
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { client } = useApi()
  const [d, setD] = useState<SupplierDraft>(() => draftOf(supplier))
  const [errors, setErrors] = useState<SupplierErrors>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setD(draftOf(supplier))
      setErrors({})
      setServerError(undefined)
    }
  }, [open, supplier])

  /** A text field of the draft, with its label, error and optional hint. */
  const text = (key: keyof SupplierDraft, label: string, extra: { required?: boolean; hint?: string; type?: string; autoFocus?: boolean; className?: string; mono?: boolean } = {}) => (
    <Field label={label} required={extra.required ?? false} error={errors[key]} hint={extra.hint} className={extra.className}>
      {(p) => (
        <Input
          {...controlProps(p)}
          type={extra.type ?? 'text'}
          autoComplete="off"
          autoFocus={extra.autoFocus}
          spellCheck={extra.type === 'email' || extra.type === 'url' ? false : undefined}
          className={extra.mono ? 'font-mono' : undefined}
          value={d[key]}
          onChange={(e) => {
            setD((cur) => ({ ...cur, [key]: e.target.value }))
            setErrors(({ [key]: _, ...rest }) => rest)
          }}
        />
      )}
    </Field>
  )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = validateSupplier(d)
    setErrors(v)
    setServerError(undefined)
    if (Object.keys(v).length > 0) return
    const input = toInput(d)
    setBusy(true)
    try {
      if (supplier) await client.suppliers.update(supplier.id, input)
      else await client.suppliers.create(input)
      onSaved(supplier ? t.suppliers.saved(input.name) : t.suppliers.added(input.name))
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) setErrors({ code: t.suppliers.codeTaken })
      else setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={supplier ? t.suppliers.editSupplier(supplier.name) : t.suppliers.addSupplier}
      description={supplier ? t.suppliers.editDescription : t.suppliers.addDescription}
      footer={<FormSheetActions form="supplier-form" onCancel={onClose} busy={busy} submitLabel={supplier ? undefined : t.suppliers.addSupplier} />}
    >
      <form id="supplier-form" onSubmit={submit} className="grid gap-6 sm:grid-cols-2" noValidate>
        <Section title={t.suppliers.company}>
          {text('name', t.suppliers.name, { required: true, autoFocus: true, className: 'sm:col-span-2' })}
          {text('code', t.suppliers.code, { required: true, mono: true })}
          {text('company_code', t.suppliers.companyCode)}
          {text('vat_code', t.suppliers.vatCode)}
          {text('bank_account', t.suppliers.bankAccount, { hint: t.suppliers.bankAccountHint, mono: true })}
        </Section>
        <Section title={t.suppliers.addressSection}>
          {text('address', t.suppliers.address, { className: 'sm:col-span-2' })}
          {text('city', t.suppliers.city)}
          {text('postal_code', t.suppliers.postalCode)}
          {text('country', t.suppliers.country, { hint: t.suppliers.countryHint })}
        </Section>
        <Section title={t.suppliers.contactSection}>
          {text('contact_person', t.suppliers.contactPerson, { className: 'sm:col-span-2' })}
          {text('email', t.suppliers.email, { type: 'email' })}
          {text('phone', t.suppliers.phone, { type: 'tel' })}
          {text('website', t.suppliers.website, { type: 'url', className: 'sm:col-span-2' })}
        </Section>
        <Field label={t.suppliers.notes} error={errors.notes} className="sm:col-span-2">
          {(p) => (
            <Textarea
              {...controlProps(p)}
              value={d.notes}
              onChange={(e) => {
                setD((cur) => ({ ...cur, notes: e.target.value }))
                setErrors(({ notes: _, ...rest }) => rest)
              }}
            />
          )}
        </Field>
        {serverError ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {serverError}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}
