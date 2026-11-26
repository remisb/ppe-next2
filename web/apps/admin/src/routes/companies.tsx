import type { Company } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { EXPORT_MODE, ExportMode } from '@ppe/ui/components/export-mode'
import { Field, Input, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { RowCheckbox, SelectAllCheckbox, selectCellClass, selectRowClass } from '@ppe/ui/components/selection-bar'
import { SortMenu, SortableHead } from '@ppe/ui/components/sortable'
import { ActionError, EmptyState, Loaded, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { type SortColumn, type SortState, newestFirst, sortRows } from '@ppe/ui/lib/sort'
import { useAction } from '@ppe/ui/lib/use-action'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { selectRowProps, useSelection } from '@ppe/ui/lib/use-selection'
import { cn } from '@ppe/ui/lib/utils'
import { Download, Plus } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react'

import { t } from '@/i18n'
import { type CompanyDraft, type CompanyErrors, deleteRefusal, draftOf, matches, placeOf, toInput, validateCompany } from '@/lib/companies'
import { companyExportColumns } from '@/lib/list-export'
import type { Route } from '@/lib/router'

/** A row's key in the selection; a module constant, so the hook's memos hold. */
const companyId = (c: Company) => c.id

type CompanySort = 'code' | 'name' | 'place' | 'employees'

const columns = (): SortColumn<CompanySort>[] => [
  { key: 'name', label: t.companies.name, kind: 'text' },
  { key: 'code', label: t.companies.code, kind: 'text' },
  { key: 'place', label: t.companies.place, kind: 'text' },
  { key: 'employees', label: t.companies.employees, kind: 'number' },
]

/**
 * Companies: the organisation's companies that employees are employed by, one
 * of them the default (Add New Employee chooses it first; mail templates name
 * it). The default and a company employing anyone are not deleted.
 */
export function CompaniesPage({ navigate }: { navigate: (to: Route) => void }) {
  const { client } = useApi()
  const session = useSession()
  const canExport = session.can('data.export')
  const allowed = session.can('companies.manage')
  const list = useLoad(() => (allowed ? client.companies.list() : Promise.resolve([])))
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<Company | 'new' | null>(null)
  // What the last save, Make Default or delete did, as a status line (a screen reader hears it too).
  const [saved, setSaved] = useState('')
  const action = useAction()
  // Newest first until a column is sorted (WARE-55); a third click on it returns there.
  const [sort, setSort] = useState<SortState<CompanySort> | null>(null)
  const sortProps = { sort, onSort: setSort, allowNone: true }

  const shown = useMemo(
    () =>
      sortRows(
        newestFirst((list.data ?? []).filter((c) => matches(c, filter))),
        sort,
        (c, key) => (key === 'place' ? placeOf(c) : key === 'employees' ? c.employee_count : c[key]),
      ),
    [list.data, filter, sort],
  )
  // The companies ticked for Export: only those the search shows count.
  const selection = useSelection(shown, companyId)

  if (!allowed) {
    return (
      <>
        <PageHeader title={t.companies.title} />
        <EmptyState>{t.companies.onlyManagers}</EmptyState>
      </>
    )
  }

  const remove = async (c: Company) => {
    const refusal = deleteRefusal(c)
    if (refusal) {
      action.fail(new Error(refusal))
      return
    }
    const done = await action.run(() => client.companies.remove(c.id), { confirm: t.companies.deleteQuestion(c.name) })
    if (done) {
      setSaved(t.companies.deleted(c.name))
      list.reload()
    }
  }

  const makeDefault = async (c: Company) => {
    const done = await action.run(() => client.companies.makeDefault(c.id))
    if (done) {
      setSaved(t.companies.madeDefault(c.name))
      list.reload()
    }
  }

  return (
    <>
      <PageHeader
        title={t.companies.title}
        description={t.companies.description}
        // Export: in the header from md, in ⋯ below; it starts select mode (WARE-45), on a phone too.
        secondary={canExport ? [{ label: t.common.export, icon: Download, onClick: () => selection.start(EXPORT_MODE), showFrom: 'md', disabled: shown.length === 0 || selection.active }] : []}
        primary={{ label: t.companies.addCompany, short: t.common.add, icon: Plus, onClick: () => setEditing('new') }}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          type="search"
          enterKeyHint="search"
          placeholder={t.companies.searchPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t.companies.searchLabel}
          data-shortcut="search"
          className="min-w-0 flex-1 md:max-w-sm"
        />
      </div>
      <ActionError error={action.error} className="mb-4" />
      <p role="status" className="mb-3 text-sm text-muted-foreground empty:hidden">
        {saved}
      </p>
      {/* Export starts select mode (WARE-45): its bar, the checkboxes, then the sheet. */}
      {canExport ? <ExportMode selection={selection} list={t.companies.title} columns={companyExportColumns()} shown={shown} /> : null}
      <Loaded load={list} empty={shown.length === 0} emptyState={filter.trim() ? t.companies.noMatch(filter.trim()) : t.companies.noCompanies}>
        {() => (
          // Where the table is narrow the companies are one list of rows: name, then code and place, with Edit and ⋯ beside them.
          <Table stack="list" stickyHead sortControl={<SortMenu columns={columns()} {...sortProps} />}>
            <TableHeader>
              <TableRow>
                {selection.active ? (
                  <TableHead className={selectCellClass}>
                    <SelectAllCheckbox selection={selection} />
                  </TableHead>
                ) : null}
                {columns().map((c) => (
                  <SortableHead key={c.key} column={c} {...sortProps} />
                ))}
                <TableHead className="text-right">{t.companies.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((c) => (
                <TableRow key={c.id} {...selectRowProps(selection, c.id)} className={cn('stacked:grid stacked:grid-cols-[minmax(0,1fr)_auto] stacked:gap-x-3', selectRowClass(selection, c.id))}>
                  {selection.active ? (
                    <TableCell className={selectCellClass}>
                      <RowCheckbox selection={selection} id={c.id} name={c.name} />
                    </TableCell>
                  ) : null}
                  <TableCell className="font-medium whitespace-normal stacked:col-start-1 stacked:row-start-1">
                    {c.name}
                    {c.is_default ? (
                      <Badge variant="secondary" className="ml-2 align-middle" title={t.companies.defaultHint}>
                        {t.companies.defaultBadge}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-sm stacked:col-start-1 stacked:row-start-2 stacked:text-xs stacked:text-muted-foreground">{c.code}</TableCell>
                  <TableCell className="stacked:col-start-1 stacked:row-start-3 stacked:text-xs stacked:text-muted-foreground">{placeOf(c)}</TableCell>
                  <TableCell className="tabular-nums stacked:hidden">{c.employee_count}</TableCell>
                  <TableCell className="text-right whitespace-nowrap stacked:col-start-2 stacked:flex stacked:[grid-row:1/span_3] stacked:items-center stacked:gap-1">
                    {/* In select mode the row's own actions step aside: a click ticks the row. */}
                    {selection.active ? null : (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setEditing(c)} aria-label={t.companies.editLabel(c.name)}>
                          {t.common.edit}
                        </Button>{' '}
                        <MoreActions label={t.common.moreActions(c.name)}>
                          {c.is_default ? null : <DropdownMenuItem onClick={() => void makeDefault(c)}>{t.companies.makeDefault}</DropdownMenuItem>}
                          {session.can('audit.read') ? (
                            <DropdownMenuItem onClick={() => navigate({ name: 'audit', filter: { entity_type: 'company', entity_id: c.id } })}>
                              {t.companies.changes}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem variant="destructive" onClick={() => void remove(c)}>
                            {t.companies.deleteCompany}
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
      <CompanyForm
        open={editing !== null}
        company={editing === 'new' || editing === null ? undefined : editing}
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

/** Add Company or Edit Company: the company, its address and notes. Which is the default is Make Default's. */
function CompanyForm({
  open,
  company,
  onClose,
  onSaved,
}: {
  open: boolean
  company: Company | undefined
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { client } = useApi()
  const [d, setD] = useState<CompanyDraft>(() => draftOf(company))
  const [errors, setErrors] = useState<CompanyErrors>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setD(draftOf(company))
      setErrors({})
      setServerError(undefined)
    }
  }, [open, company])

  /** A text field of the draft, with its label, error and optional hint. */
  const text = (key: keyof CompanyDraft, label: string, extra: { required?: boolean; hint?: string; autoFocus?: boolean; className?: string; mono?: boolean } = {}) => (
    <Field label={label} required={extra.required ?? false} error={errors[key]} hint={extra.hint} className={extra.className}>
      {(p) => (
        <Input
          {...controlProps(p)}
          autoComplete="off"
          autoFocus={extra.autoFocus}
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
    const v = validateCompany(d)
    setErrors(v)
    setServerError(undefined)
    if (Object.keys(v).length > 0) return
    const input = toInput(d)
    setBusy(true)
    try {
      if (company) await client.companies.update(company.id, input)
      else await client.companies.create(input)
      onSaved(company ? t.companies.saved(input.name) : t.companies.added(input.name))
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) setErrors({ code: t.companies.codeTaken })
      else setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={company ? t.companies.editCompany(company.name) : t.companies.addCompany}
      description={company ? t.companies.editDescription : t.companies.addDescription}
      footer={<FormSheetActions form="company-form" onCancel={onClose} busy={busy} submitLabel={company ? undefined : t.companies.addCompany} />}
    >
      <form id="company-form" onSubmit={submit} className="grid gap-6 sm:grid-cols-2" noValidate>
        <Section title={t.companies.company}>
          {text('name', t.companies.name, { required: true, autoFocus: true, className: 'sm:col-span-2' })}
          {text('code', t.companies.code, { hint: t.companies.codeHint, mono: true })}
          {text('company_code', t.companies.companyCode)}
          {text('vat_code', t.companies.vatCode)}
        </Section>
        <Section title={t.companies.addressSection}>
          {text('address', t.companies.address, { className: 'sm:col-span-2' })}
          {text('city', t.companies.city)}
          {text('postal_code', t.companies.postalCode)}
          {text('country', t.companies.country, { hint: t.companies.countryHint })}
        </Section>
        <Field label={t.companies.notes} error={errors.notes} className="sm:col-span-2">
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
