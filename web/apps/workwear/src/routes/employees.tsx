import { type Employee, type EmployeePair, type EmployeeStatus, SHARE_DAYS, SHARE_MAX_ROWS, type ShareDays, type Sizes } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { IssueBadge } from '@ppe/ui/components/issue-badge'
import { Button } from '@ppe/ui/components/button'
import { Field, Input, Select, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { RowActions } from '@ppe/ui/components/action-menu'
import { SortMenu, SortableHead } from '@ppe/ui/components/sortable'
import { ActionError, Loaded, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { type SortColumn, type SortState, sortRows } from '@ppe/ui/lib/sort'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { linkVariants } from '@ppe/ui/components/link'
import { Segmented } from '@ppe/ui/components/segmented'
import { useAction } from '@ppe/ui/lib/use-action'
import { besideList, useCloseFilteredOut, useListKeys } from '@ppe/ui/lib/list-keys'
import { DetailPane, ListDetail } from '@ppe/ui/components/list-detail'
import { EXPORT_MODE, ExportMode } from '@ppe/ui/components/export-mode'
import type { ShareOptions } from '@ppe/ui/components/export-sheet'
import { RowCheckbox, SelectAllCheckbox, selectCellClass, selectRowClass } from '@ppe/ui/components/selection-bar'
import { selectRowProps, useSelection } from '@ppe/ui/lib/use-selection'
import { ChevronRight, Download, Link2, Plus, Share2, Users } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { EmployeeDetail } from '@/routes/employee'
import { EmployeeForm } from '@/components/employee-form'
import { MergeEmployeesSheet } from '@/components/merge-employees-sheet'
import { t } from '@/i18n'
import { isMissingASize, missingSizes } from '@/lib/missing-sizes'
import { cn } from '@ppe/ui/lib/utils'
import { EmployeeAvatar } from '@/components/employee-photo'
import { addPhotos, photoRefusal, useRowFileDrop } from '@/lib/photo-drop'
import { employeeActions } from '@/lib/employee-actions'
import { employeeExportColumns } from '@/lib/employee-export'
import { STATUSES, countByStatus } from '@/lib/employment'
import { StatusBadge } from '@/components/employment-section'
import { employeeFacts, missingLabel } from '@/lib/records'
import { type NavigateOptions, type Route, linkOpening } from '@/lib/router'
import { clothingBandValue, clothingBands, clothingSizeLabel, formatSize } from '@/lib/utils'

/** An employee's key in the selection; a module constant, so the hook's memos hold. */
const employeeId = (e: Employee) => e.id

type EmployeeSort = 'name' | 'company' | 'code' | 'height' | 'clothing' | 'shoes'

/** Fixed column widths; the name takes the rest. */
// The company only where the table has the room (72rem): beside the sizes it would squeeze the names.
const employeeWidths: Partial<Record<EmployeeSort, string>> = { company: 'hidden w-44 @6xl/table:table-cell', code: 'w-32', height: 'w-24', clothing: 'w-40', shoes: 'w-32' }

// A function, so the labels are read in the language in use.
const employeeColumns = (): SortColumn<EmployeeSort>[] => [
  { key: 'name', label: t.employees.name, kind: 'text' },
  { key: 'company', label: t.employment.company, kind: 'text' },
  { key: 'code', label: t.employees.code, kind: 'text' },
  { key: 'height', label: t.employees.height, kind: 'number' },
  { key: 'clothing', label: t.employees.clothing, kind: 'size' },
  { key: 'shoes', label: t.employees.shoes, kind: 'size' },
]

export function Employees({
  missing = false,
  selected,
  navigate,
}: {
  missing?: boolean
  /** The employee open beside the list (/employees/<id>). */
  selected?: string | undefined
  navigate: (to: Route, options?: NavigateOptions) => void
}) {
  const { client } = useApi()
  const session = useSession()
  // Names are everyone's; sizes take See employee sizes, the code, notes and photos See employee profiles (the API leaves them blank).
  const seesSizes = session.can('employee_sizes.read')
  const seesProfile = session.can('employee_profiles.read')
  const canExport = session.can('data.export')
  // Sharing (WARE-51): Copy as Text and Share Link beside Export's files, for everyone, up to 10 rows.
  const share: ShareOptions<Employee> = {
    files: canExport,
    limit: SHARE_MAX_ROWS,
    days: SHARE_DAYS,
    defaultName: (rows) => {
      const names = rows.map((e) => e.full_name)
      return names.length <= 3 ? names.join(', ') : t.shares.namesAndMore(names.slice(0, 2).join(', '), names.length - 2)
    },
    link: async ({ name, columns, rows, days }) => {
      const made = await client.shares.create({ kind: 'employees', name, columns, ids: rows.map((e) => e.id), days: days as ShareDays })
      return { url: made.url, expires_at: made.share.expires_at }
    },
    onManage: () => navigate({ name: 'sharedLinks' }),
  }
  const managesSizes = session.can('employee_sizes.manage')
  const managesProfile = session.can('employee_profiles.manage')
  const merges = session.can('employees.merge')
  const employees = useLoad(() => client.employees.list())
  // Pairs that may be one person, for whoever may merge them.
  const pairs = useLoad(() => (merges ? client.employees.possibleDuplicates() : Promise.resolve([])))
  const [merging, setMerging] = useState<{ start: Employee; other?: Employee } | null>(null)
  const sizes = useLoad(() => client.sizes())
  // Clothing sizes are named as the pickers name them: 46 is "S (44–46)".
  const bands = useMemo(() => clothingBands(sizes.data?.clothing ?? []), [sizes.data])
  // The companies, for the Company column and filter, shown when there is more than one.
  const companies = useLoad(() => client.companies.list())
  const severalCompanies = (companies.data?.length ?? 0) > 1
  const [filter, setFilter] = useState('')
  // The status tab: Employees, Candidates or Former; or Missing a size (anyone not a former employee).
  const [tab, setTab] = useState<EmployeeStatus | 'missing'>(missing && seesSizes ? 'missing' : 'employee')
  const onlyMissing = tab === 'missing'
  // A company chosen in the filter (the open employment's), '' for all; on the Employees and Missing tabs.
  const [company, setCompany] = useState('')
  const companyShown = severalCompanies && (tab === 'employee' || tab === 'missing')
  const columns = employeeColumns().filter((c) =>
    c.key === 'company' ? severalCompanies && tab !== 'candidate' && tab !== 'former' : c.key === 'code' ? seesProfile : c.key === 'name' || seesSizes,
  )
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [sizing, setSizing] = useState<Employee | null>(null)
  const action = useAction()
  const [sort, setSort] = useState<SortState<EmployeeSort> | null>({ key: 'name', dir: 'asc' })

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matching = (employees.data ?? []).filter(
      (e) =>
        (!q || `${e.full_name} ${e.code ?? ''}`.toLowerCase().includes(q)) &&
        (onlyMissing ? e.status !== 'former' && isMissingASize(e) : e.status === tab) &&
        (!companyShown || !company || e.company?.id === company),
    )
    // Clothing (EU) and shoe sizes are numbers, so they sort as numbers.
    return sortRows(matching, sort, (e, key) => {
      switch (key) {
        case 'name':
          return e.full_name
        case 'company':
          return e.company?.name ?? null
        case 'code':
          return e.code
        case 'height':
          return e.height_cm
        case 'clothing':
          return e.clothing_size
        case 'shoes':
          return e.shoe_size ? Number(e.shoe_size) : null
      }
    })
  }, [employees.data, filter, tab, onlyMissing, company, companyShown, sort])
  const sortProps = { sort, onSort: setSort }
  const missingCount = seesSizes ? (employees.data ?? []).filter((e) => e.status !== 'former' && isMissingASize(e)).length : 0
  const counts = countByStatus(employees.data ?? [])

  const remove = (e: Employee) =>
    action.run(
      async () => {
        await client.employees.remove(e.id)
        employees.reload()
      },
      { confirm: t.employees.confirmDelete(e.full_name) },
    )

  // A photo dropped on an employee's row is added to their photos; the first one becomes their avatar.
  const [notice, setNotice] = useState<string>()
  const [paneVersion, setPaneVersion] = useState(0)
  const photoDrop = useRowFileDrop((id, files) => {
    const emp = employees.data?.find((x) => x.id === id)
    if (!emp) return
    setNotice(undefined)
    void action.run(
      async () => {
        setNotice(await addPhotos(client, emp, files))
        employees.reload()
        // The employee open beside the list shows the new photos too.
        if (id === selected) setPaneVersion((v) => v + 1)
      },
      { mapError: photoRefusal },
    )
  })

  const notSame = (a: Employee, b: Employee) =>
    action.run(async () => {
      await client.employees.markDistinct(a.id, b.id)
      setNotice(t.employees.duplicates.notSameDone(a.full_name, b.full_name))
      pairs.reload()
    })

  const open = (id: string) => navigate({ name: 'employee', id }, { scroll: !besideList() })
  const close = () => navigate({ name: 'employees' }, { scroll: false })
  // J and K: the next or previous employee in the list as shown, while one is open; Escape closes her beside the list.
  const shownIds = useMemo(() => shown.map((e) => e.id), [shown])
  // The employees ticked for Export: only those the tab and search show count.
  const selection = useSelection(shown, employeeId)
  useListKeys({ ids: shownIds, selected, onOpen: (id) => navigate({ name: 'employee', id }, { scroll: false }), onClose: close })
  // A search, tab or company that leaves the open employee out of the list closes them (WARE-42).
  useCloseFilteredOut({
    filters: JSON.stringify([filter.trim().toLowerCase(), tab, companyShown ? company : '']),
    current: employees.data !== undefined,
    ids: shownIds,
    selected,
    onClose: () => navigate({ name: 'employees' }, { replace: true, scroll: false }),
  })

  return (
    // An employee opens beside the list from lg (S17), with more room than an order: her sections hold tables.
    <ListDetail
      width="lg"
      pane={
        selected ? (
          <DetailPane label={t.employees.employee} next={t.employees.nextOrPrevious}>
            <EmployeeDetail key={`${selected}.${paneVersion}`} id={selected} place={{ page: false, onClose: close, onChanged: employees.reload }} navigate={navigate} />
          </DetailPane>
        ) : null
      }
    >
      <PageHeader
        title={t.employees.title}
        description={t.employees.description}
        // Export (data.export) or, without it, Share (everyone's, WARE-51): in the header from md, in ⋯ below
        // (a phone exports all shown: its list has no checkboxes). Shared Links always in ⋯.
        secondary={[
          {
            label: canExport ? t.common.export : t.common.share,
            icon: canExport ? Download : Share2,
            onClick: () => selection.start(EXPORT_MODE),
            showFrom: 'md',
            disabled: shown.length === 0 || selection.active,
          },
          { label: t.shares.title, icon: Link2, onClick: () => navigate({ name: 'sharedLinks' }), showFrom: 'never' },
        ]}
        primary={managesProfile ? { label: t.employees.addNew, short: t.common.add, icon: Plus, onClick: () => setEditing('new') } : undefined}
      />
      {/* As on every list: the tabs first, then the search. */}
      <div data-slot="filter-bar" className="mb-4 flex flex-col gap-3">
        {/* The same tabs as Orders, each with its tooltip: the status, then Missing a size when anyone is; on a phone they scroll sideways. */}
        <Segmented
          layout="scroll"
          label={t.employees.show}
          options={[
            ...STATUSES.map((s) => ({ value: s, label: t.employment.tabs[s], help: t.employment.tabHelp[s], count: counts[s] })),
            ...(missingCount > 0 || onlyMissing ? [{ value: 'missing' as const, label: t.employees.missingTab, help: t.employees.tabHelp.missing, count: missingCount }] : []),
          ]}
          value={tab}
          // Missing a size again goes back to Employees.
          onChange={(v) => setTab(v === 'missing' && onlyMissing ? 'employee' : v)}
        />
        <div className="flex flex-wrap gap-2">
          <Input
            type="search"
            enterKeyHint="search"
            placeholder={t.employees.searchPlaceholder}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={t.employees.searchLabel}
            data-shortcut="search"
            className="min-w-0 flex-1 md:max-w-sm"
          />
          {companyShown ? (
            <Select aria-label={t.employment.companyFilter} value={company} onChange={(e) => setCompany(e.target.value)} className="w-auto max-w-full">
              <option value="">{t.employment.allCompanies}</option>
              {(companies.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      </div>
      {pairs.data && pairs.data.length > 0 ? (
        <DuplicatesNotice
          pairs={pairs.data}
          onReview={(a, b) => setMerging({ start: a, other: b })}
          onNotSame={(a, b) => void notSame(a, b)}
        />
      ) : null}
      <ActionError error={action.error} />
      {notice ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {/* Export starts select mode (WARE-45): its bar, the checkboxes, then the sheet. */}
      <ExportMode selection={selection} list={t.employees.title} columns={employeeExportColumns({ sizes: seesSizes, profile: seesProfile })} shown={shown} share={share} />
      <Loaded
        load={employees}
        empty={shown.length === 0}
        emptyState={
          onlyMissing && !filter
            ? t.employees.everyoneHasSizes
            : filter
              ? t.employees.noMatch(filter.trim())
              : tab === 'candidate' || tab === 'former'
                ? t.employment.noneInTab[tab]
                : t.employees.noneYet
        }
      >
        {() => (
          /*
            Where the table is narrow the employees are one list of two-line rows:
            name (a missing size flagged beside it), then code and saved sizes,
            then the note, if any, on a third line.
            A row opens the employee, whose page holds Edit Sizes, New order and
            Delete; the table keeps Edit Sizes and ⋯ on each row.
          */
          <Table stack="list" fixed stickyHead sortControl={<SortMenu columns={columns} {...sortProps} />}>
            <TableHeader>
              <TableRow>
                {/* The checkboxes are there only in select mode (WARE-45). */}
                {selection.active ? (
                  <TableHead className={selectCellClass}>
                    <SelectAllCheckbox selection={selection} />
                  </TableHead>
                ) : null}
                {columns.map((c) => (
                  <SortableHead key={c.key} column={c} className={employeeWidths[c.key]} {...sortProps} />
                ))}
                <TableHead className="w-44 text-right">{selection.active ? null : t.employees.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((e) => {
                const missing = seesSizes ? missingSizes(e) : { clothing: false, shoes: false }
                const flag = seesSizes ? missingLabel(e) : undefined
                return (
                  <TableRow
                    key={e.id}
                    data-state={selected === e.id ? 'selected' : undefined}
                    aria-current={selected === e.id ? 'true' : undefined}
                    {...(managesProfile ? photoDrop.rowProps(e.id) : {})}
                    // In select mode a click anywhere on the row ticks it instead.
                    {...selectRowProps(selection, e.id)}
                    className={cn(
                      'cursor-pointer hover:bg-muted/50 stacked:grid stacked:grid-cols-[auto_minmax(0,1fr)_auto] stacked:gap-x-3 stacked:hover:bg-muted/50 stacked:data-[state=selected]:bg-muted',
                      selectRowClass(selection, e.id),
                      // Photos dragged over the row: dropping adds them to this employee.
                      photoDrop.overId === e.id && 'bg-accent outline-2 -outline-offset-2 outline-ring outline-dashed',
                    )}
                    // The whole row opens the employee; the name is the real link, for keyboards,
                    // screen readers and "open in new tab". The row's own buttons keep their action.
                    onClick={(ev) => {
                      if ((ev.target as Element).closest('a, button, input, [data-slot=select-cell]') || window.getSelection()?.toString()) return
                      open(e.id)
                    }}
                  >
                    {selection.active ? (
                      <TableCell className={selectCellClass}>
                        <RowCheckbox selection={selection} id={e.id} name={e.full_name} />
                      </TableCell>
                    ) : null}
                    <TableCell aria-hidden className="hidden stacked:col-start-1 stacked:flex stacked:[grid-row:1/span_3]">
                      <EmployeeAvatar employee={e} />
                    </TableCell>
                    <TableCell className="font-medium whitespace-normal stacked:col-start-2 stacked:row-start-1 stacked:flex stacked:min-w-0 stacked:items-center stacked:justify-between stacked:gap-2">
                      <div className="flex items-center gap-3 stacked:contents">
                        {/* In the table the avatar leads the name; stacked, it has a cell of its own on the left. */}
                        <EmployeeAvatar employee={e} className="stacked:hidden" />
                        <div className="min-w-0 stacked:contents">
                          {/* A click opens her beside the list; a new tab (middle click, copy link) opens her page. */}
                          <a {...linkOpening({ name: 'employeePage', id: e.id }, () => open(e.id))} className={linkVariants()}>
                            {e.full_name}
                          </a>
                          {/* On Missing a size a candidate says so; each tab is one status otherwise. */}
                          {onlyMissing ? <StatusBadge status={e.status} className="ml-2 align-middle" /> : null}
                          {/* The company under the name where its column has no room. */}
                          {e.company && columns.some((c) => c.key === 'company') ? (
                            <p className="truncate text-xs font-normal text-muted-foreground stacked:hidden @6xl/table:hidden">{e.company.name}</p>
                          ) : null}
                          {/* The note on one line under the name, in full on hover and on the employee's page. */}
                          {e.notes ? (
                            <p title={e.notes} className="max-w-xs truncate text-xs font-normal text-muted-foreground stacked:hidden">
                              {e.notes}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {/* Stacked, the sizes Create Order will ask for; the table flags them in their columns. */}
                      {flag ? (
                        <IssueBadge label={flag} variant="destructive" issues={[t.employees.missingTitle]} className="hidden shrink-0 stacked:inline-flex" />
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden stacked:col-start-2 stacked:row-start-2 stacked:block stacked:text-xs stacked:text-muted-foreground">
                      {[columns.some((c) => c.key === 'company') ? e.company?.name : null, employeeFacts(e, bands) || (seesSizes ? t.employees.noSizesSaved : null)]
                        .filter(Boolean)
                        .join(' · ')}
                    </TableCell>
                    {e.notes ? (
                      <TableCell title={e.notes} className="hidden stacked:col-start-2 stacked:row-start-3 stacked:block stacked:truncate stacked:text-xs stacked:text-muted-foreground">
                        {e.notes}
                      </TableCell>
                    ) : null}
                    {columns.some((c) => c.key === 'company') ? <TableCell className="hidden truncate @6xl/table:table-cell stacked:hidden">{e.company?.name ?? '–'}</TableCell> : null}
                    {seesProfile ? <TableCell className="stacked:hidden">{e.code ?? '–'}</TableCell> : null}
                    {seesSizes ? (
                      <>
                        {/* A height alone is not needed once the clothing size is saved, so then its badge is grey. */}
                        <TableCell className="stacked:hidden">{e.height_cm ? t.employees.heightCm(e.height_cm) : <MissingBadge optional={!missing.clothing} />}</TableCell>
                        <TableCell className="stacked:hidden">{missing.clothing ? <MissingBadge /> : clothingSizeLabel(bands, e.clothing_size)}</TableCell>
                        <TableCell className="stacked:hidden">{missing.shoes ? <MissingBadge /> : formatSize(e.shoe_size)}</TableCell>
                      </>
                    ) : null}
                    <TableCell aria-hidden className="hidden stacked:col-start-3 stacked:flex stacked:[grid-row:1/span_3]">
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap stacked:hidden">
                      {/* In select mode the row's own actions step aside: a click ticks the row. */}
                      {selection.active ? null : managesSizes ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setSizing(e)}>
                            {t.employees.editSizes}
                          </Button>{' '}
                        </>
                      ) : null}
                      {/* The employee's own actions, as the employee's page has them (employeeActions). */}
                      {selection.active ? null : (
                        <RowActions
                          label={t.common.moreActions(e.full_name)}
                          actions={employeeActions(
                            { editDetails: managesProfile, merge: merges, remove: session.can('employees.delete') },
                            {
                              newOrder: () => navigate({ name: 'createOrder', prefill: { employeeId: e.id, items: [] } }),
                              editDetails: () => setEditing(e),
                              merge: () => setMerging({ start: e }),
                              remove: () => void remove(e),
                            },
                          )}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Loaded>
      <EmployeeForm
        open={editing !== null}
        employee={editing === 'new' || editing === null ? undefined : editing}
        sizes={sizes.data}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          employees.reload()
          pairs.reload()
        }}
        // Add New Employee's Use This Employee: the employee already here opens instead.
        onUseExisting={(e) => {
          setEditing(null)
          open(e.id)
        }}
      />
      <MergeEmployeesSheet
        start={merging?.start ?? null}
        other={merging?.other}
        sizes={sizes.data}
        onClose={() => setMerging(null)}
        onMerged={(kept, removed) => {
          setMerging(null)
          setNotice(t.employees.merge.merged(removed.full_name, kept.full_name))
          employees.reload()
          pairs.reload()
          navigate({ name: 'employee', id: kept.id }, { scroll: false })
          setPaneVersion((v) => v + 1)
        }}
      />
      <EditSizes
        employee={sizing}
        sizes={sizes.data}
        onClose={() => setSizing(null)}
        onSaved={() => {
          setSizing(null)
          employees.reload()
        }}
      />
    </ListDetail>
  )
}

/**
 * A size Create Order will ask for, saying so (IssueBadge); `optional`, one it
 * can do without (a height beside a saved clothing size), a plain badge.
 */
export function MissingBadge({ optional = false }: { optional?: boolean }) {
  return <IssueBadge label={t.employees.missing} variant={optional ? 'secondary' : 'destructive'} issues={optional ? [] : [t.employees.missingTitle]} />
}

/**
 * The sizes being edited for `employee` (null: none), reset whenever it changes. Shared by the
 * Edit Sizes sheet and the employee page, which edits them in place.
 */
export function useSizesDraft(employee: Employee | null, onSaved: () => void) {
  const { client } = useApi()
  const [height, setHeight] = useState('')
  const [clothing, setClothing] = useState('')
  const [shoe, setShoe] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setHeight(employee?.height_cm?.toString() ?? '')
    setClothing(employee?.clothing_size?.toString() ?? '')
    setShoe(employee?.shoe_size ?? '')
    setError(undefined)
  }, [employee])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!employee || busy) return
    const h = height.trim() === '' ? null : Number(height)
    if (h !== null && (!Number.isInteger(h) || h < 100 || h > 250)) {
      setError(t.employees.heightRange)
      return
    }
    setBusy(true)
    try {
      await client.employees.updateSizes(employee.id, { height_cm: h, clothing_size: clothing ? Number(clothing) : null, shoe_size: shoe || null })
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return { height, setHeight, clothing, setClothing, shoe, setShoe, error, busy, submit }
}

export type SizesDraft = ReturnType<typeof useSizesDraft>

export type SizeField = 'height' | 'clothing' | 'shoe'

/** Height, Clothing size and Shoe size, as fields of a form. */
// On a phone each size is one line, its label beside the control.
const sizeRow = 'max-sm:grid max-sm:grid-cols-[7.5rem_minmax(0,1fr)] max-sm:items-center max-sm:gap-x-3'

/** `autoFocus`: the field that takes focus when they appear. */
export function SizeFields({ draft, sizes, autoFocus }: { draft: SizesDraft; sizes: Sizes | undefined; autoFocus?: SizeField }) {
  const bands = clothingBands(sizes?.clothing ?? [])
  return (
    <>
      <Field label={t.employees.heightLabel} className={sizeRow}>
        {(p) => (
          <Input
            {...controlProps(p)}
            inputMode="numeric"
            enterKeyHint="next"
            autoFocus={autoFocus === 'height'}
            value={draft.height}
            onChange={(e) => draft.setHeight(e.target.value)}
          />
        )}
      </Field>
      <Field label={t.employees.clothingSize} className={sizeRow}>
        {(p) => (
          <Select {...controlProps(p)} autoFocus={autoFocus === 'clothing'} value={clothingBandValue(bands, draft.clothing)} onChange={(e) => draft.setClothing(e.target.value)}>
            <option value="">{t.employees.notSet}</option>
            {bands.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={t.employees.shoeSize} className={sizeRow}>
        {(p) => (
          <Select {...controlProps(p)} autoFocus={autoFocus === 'shoe'} value={draft.shoe} onChange={(e) => draft.setShoe(e.target.value)}>
            <option value="">{t.employees.notSet}</option>
            {sizes?.shoes.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  )
}

/** Edit Sizes: changes defaults for future resolutions only. */
export function EditSizes({
  employee,
  sizes,
  onClose,
  onSaved,
}: {
  employee: Employee | null
  sizes: Sizes | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const draft = useSizesDraft(employee, onSaved)

  return (
    <FormSheet
      open={employee !== null}
      onClose={onClose}
      title={t.employees.editSizesTitle(employee?.full_name ?? '')}
      description={t.employees.futureOnly}
footer={<FormSheetActions form="sizes-form" onCancel={onClose} busy={draft.busy} />}
    >
      <form id="sizes-form" onSubmit={draft.submit} className="grid gap-4 sm:grid-cols-3">
        <SizeFields draft={draft} sizes={sizes} />
        {draft.error ? <p role="alert" className="text-sm text-destructive sm:col-span-3">{draft.error}</p> : null}
      </form>
    </FormSheet>
  )
}

/**
 * The pairs of employees who may be one person: the first named, with how
 * many more, Review (Merge Employees on the pair) and Not the Same Person.
 */
function DuplicatesNotice({
  pairs,
  onReview,
  onNotSame,
}: {
  pairs: EmployeePair[]
  onReview: (a: Employee, b: Employee) => void
  onNotSame: (a: Employee, b: Employee) => void
}) {
  const [first] = pairs
  if (!first) return null
  return (
    <section role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
      <Users aria-hidden className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 basis-60">
        {t.employees.duplicates.noticePair(first.a.full_name, first.b.full_name)}
        {pairs.length > 1 ? <span className="text-muted-foreground"> {t.employees.duplicates.noticeMore(pairs.length - 1)}</span> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onReview(first.a, first.b)}>
          {t.employees.duplicates.review}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onNotSame(first.a, first.b)}>
          {t.employees.duplicates.notSame}
        </Button>
      </div>
    </section>
  )
}
