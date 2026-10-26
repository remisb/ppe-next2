import type { Employee, Sizes } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { IssueBadge } from '@ppe/ui/components/issue-badge'
import { Button } from '@ppe/ui/components/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@ppe/ui/components/dropdown-menu'
import { Field, Input, Select, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { SortControl, SortableHead } from '@ppe/ui/components/sortable'
import { ActionError, Loaded, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { type SortColumn, type SortState, sortRows } from '@ppe/ui/lib/sort'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { linkVariants } from '@ppe/ui/components/link'
import { Segmented } from '@ppe/ui/components/segmented'
import { useAction } from '@ppe/ui/lib/use-action'
import { besideList, useListKeys } from '@ppe/ui/lib/list-keys'
import { DetailPane, ListDetail } from '@ppe/ui/components/list-detail'
import { ChevronRight, Plus } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { EmployeePage } from '@/routes/employee'
import { EmployeeForm } from '@/components/employee-form'
import { t } from '@/i18n'
import { isMissingASize, missingSizes } from '@/lib/missing-sizes'
import { cn } from '@ppe/ui/lib/utils'
import { EmployeeAvatar } from '@/components/employee-photo'
import { addPhotos, photoRefusal, useRowFileDrop } from '@/lib/photo-drop'
import { employeeFacts, missingLabel } from '@/lib/records'
import { type NavigateOptions, type Route, linkTo } from '@/lib/router'
import { clothingBandValue, clothingBands, clothingSizeLabel, formatSize } from '@/lib/utils'

type EmployeeSort = 'name' | 'code' | 'height' | 'clothing' | 'shoes'

// A function, so the labels are read in the language in use.
const employeeColumns = (): SortColumn<EmployeeSort>[] => [
  { key: 'name', label: t.employees.name, kind: 'text' },
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
  const employees = useLoad(() => client.employees.list())
  const sizes = useLoad(() => client.sizes())
  // Clothing sizes are named as the pickers name them: 46 is "S (44–46)".
  const bands = useMemo(() => clothingBands(sizes.data?.clothing ?? []), [sizes.data])
  const columns = employeeColumns()
  const [filter, setFilter] = useState('')
  // Only those Create Order would flag for a missing size.
  const [onlyMissing, setOnlyMissing] = useState(missing)
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [sizing, setSizing] = useState<Employee | null>(null)
  const action = useAction()
  const [sort, setSort] = useState<SortState<EmployeeSort> | null>({ key: 'name', dir: 'asc' })

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matching = (employees.data ?? []).filter(
      (e) => (!q || `${e.full_name} ${e.code ?? ''}`.toLowerCase().includes(q)) && (!onlyMissing || isMissingASize(e)),
    )
    // Clothing (EU) and shoe sizes are numbers, so they sort as numbers.
    return sortRows(matching, sort, (e, key) => {
      switch (key) {
        case 'name':
          return e.full_name
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
  }, [employees.data, filter, onlyMissing, sort])
  const sortProps = { sort, onSort: setSort }
  const missingCount = (employees.data ?? []).filter(isMissingASize).length

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

  const open = (id: string) => navigate({ name: 'employee', id }, { scroll: !besideList() })
  const close = () => navigate({ name: 'employees' }, { scroll: false })
  // J and K: the next or previous employee in the list as shown, while one is open; Escape closes her beside the list.
  const shownIds = useMemo(() => shown.map((e) => e.id), [shown])
  useListKeys({ ids: shownIds, selected, onOpen: (id) => navigate({ name: 'employee', id }, { scroll: false }), onClose: close })

  return (
    // An employee opens beside the list from lg (S17), with more room than an order: her sections hold tables.
    <ListDetail
      width="lg"
      pane={
        selected ? (
          <DetailPane label={t.employees.employee} next={t.employees.nextOrPrevious}>
            <EmployeePage key={`${selected}.${paneVersion}`} id={selected} navigate={navigate} onClose={close} onChanged={employees.reload} />
          </DetailPane>
        ) : null
      }
    >
      <PageHeader
        title={t.employees.title}
        description={t.employees.description}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t.employees.addNew}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          enterKeyHint="search"
          placeholder={t.employees.searchPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t.employees.searchLabel}
          data-shortcut="search"
          className="min-w-48 flex-1 md:max-w-sm md:flex-none"
        />
        {missingCount > 0 || onlyMissing ? (
          // The same tabs as Orders, each with its tooltip; on a phone they take their own row below the search.
          <Segmented
            label={t.employees.show}
            options={[
              { value: 'all', label: t.employees.allTab, help: t.employees.tabHelp.all, count: employees.data?.length ?? 0 },
              { value: 'missing', label: t.employees.missingTab, help: t.employees.tabHelp.missing, count: missingCount },
            ]}
            value={onlyMissing ? 'missing' : 'all'}
            // Missing sizes again shows everyone, as before.
            onChange={(v) => setOnlyMissing(v === 'missing' && !onlyMissing)}
          />
        ) : null}
      </div>
      <ActionError error={action.error} />
      {notice ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}
      <Loaded
        load={employees}
        empty={shown.length === 0}
        emptyState={onlyMissing && !filter ? t.employees.everyoneHasSizes : filter ? t.employees.noMatch(filter.trim()) : t.employees.noneYet}
      >
        {() => (
          /*
            Where the table is narrow the employees are one list of two-line rows:
            name (a missing size flagged beside it), then code and saved sizes,
            then the note, if any, on a third line.
            A row opens the employee, whose page holds Edit Sizes, New order and
            Delete; the table keeps Edit Sizes and ⋯ on each row.
          */
          <Table stack="list" sortControl={<SortControl columns={columns} {...sortProps} />}>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <SortableHead key={c.key} column={c} {...sortProps} />
                ))}
                <TableHead className="text-right">{t.employees.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((e) => {
                const missing = missingSizes(e)
                const flag = missingLabel(e)
                return (
                  <TableRow
                    key={e.id}
                    data-state={selected === e.id ? 'selected' : undefined}
                    aria-current={selected === e.id ? 'true' : undefined}
                    {...photoDrop.rowProps(e.id)}
                    className={cn(
                      'cursor-pointer hover:bg-muted/50 stacked:grid stacked:grid-cols-[auto_minmax(0,1fr)_auto] stacked:gap-x-3 stacked:hover:bg-muted/50 stacked:data-[state=selected]:bg-muted',
                      // Photos dragged over the row: dropping adds them to this employee.
                      photoDrop.overId === e.id && 'bg-accent outline-2 -outline-offset-2 outline-ring outline-dashed',
                    )}
                    // The whole row opens the employee; the name is the real link, for keyboards,
                    // screen readers and "open in new tab". The row's own buttons keep their action.
                    onClick={(ev) => {
                      if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                      open(e.id)
                    }}
                  >
                    <TableCell aria-hidden className="hidden stacked:col-start-1 stacked:flex stacked:[grid-row:1/span_3]">
                      <EmployeeAvatar employee={e} />
                    </TableCell>
                    <TableCell className="font-medium stacked:col-start-2 stacked:row-start-1 stacked:flex stacked:min-w-0 stacked:items-center stacked:justify-between stacked:gap-2">
                      <div className="flex items-center gap-3 stacked:contents">
                        {/* In the table the avatar leads the name; stacked, it has a cell of its own on the left. */}
                        <EmployeeAvatar employee={e} className="stacked:hidden" />
                        <div className="min-w-0 stacked:contents">
                          <a {...linkTo({ name: 'employee', id: e.id }, navigate)} className={linkVariants()}>
                            {e.full_name}
                          </a>
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
                      {employeeFacts(e, bands) || t.employees.noSizesSaved}
                    </TableCell>
                    {e.notes ? (
                      <TableCell title={e.notes} className="hidden stacked:col-start-2 stacked:row-start-3 stacked:block stacked:truncate stacked:text-xs stacked:text-muted-foreground">
                        {e.notes}
                      </TableCell>
                    ) : null}
                    <TableCell className="stacked:hidden">{e.code ?? '–'}</TableCell>
                    {/* A height alone is not needed once the clothing size is saved, so then its badge is grey. */}
                    <TableCell className="stacked:hidden">{e.height_cm ? t.employees.heightCm(e.height_cm) : <MissingBadge optional={!missing.clothing} />}</TableCell>
                    <TableCell className="stacked:hidden">{missing.clothing ? <MissingBadge /> : clothingSizeLabel(bands, e.clothing_size)}</TableCell>
                    <TableCell className="stacked:hidden">{missing.shoes ? <MissingBadge /> : formatSize(e.shoe_size)}</TableCell>
                    <TableCell aria-hidden className="hidden stacked:col-start-3 stacked:flex stacked:[grid-row:1/span_3]">
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap stacked:hidden">
                      <Button size="sm" variant="outline" onClick={() => setSizing(e)}>
                        {t.employees.editSizes}
                      </Button>{' '}
                      <MoreActions label={t.common.moreActions(e.full_name)}>
                        <DropdownMenuItem onClick={() => setEditing(e)}>{t.employees.editDetails}</DropdownMenuItem>
                        {session.can('employees.delete') ? (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => void remove(e)}>
                              {t.employees.deleteEmployee}
                            </DropdownMenuItem>
                          </>
                        ) : null}
                      </MoreActions>
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
