import type { Employee, Sizes } from '@ppe/api-client'
import { ChevronRight, Plus } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { EmployeeForm } from '@/components/employee-form'
import { MoreActions } from '@/components/more-actions'
import { SortControl, SortableHead } from '@/components/sortable'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Field, Input, Select, controlProps } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi, useSession } from '@/lib/api'
import { isMissingASize, missingSizes } from '@/lib/missing-sizes'
import { employeeFacts, initials, missingLabel } from '@/lib/records'
import { type Route, linkTo } from '@/lib/router'
import { type SortColumn, type SortState, sortRows } from '@/lib/sort'
import { errorText, useLoad } from '@/lib/use-load'
import { clothingBandValue, clothingBands, clothingSizeLabel, formatSize } from '@/lib/utils'

type EmployeeSort = 'name' | 'code' | 'height' | 'clothing' | 'shoes'

const columns: SortColumn<EmployeeSort>[] = [
  { key: 'name', label: 'Name' },
  { key: 'code', label: 'Code' },
  { key: 'height', label: 'Height' },
  { key: 'clothing', label: 'Clothing' },
  { key: 'shoes', label: 'Shoes' },
]

export function Employees({ missing = false, navigate }: { missing?: boolean; navigate: (to: Route) => void }) {
  const { client } = useApi()
  const session = useSession()
  const employees = useLoad(() => client.employees.list())
  const sizes = useLoad(() => client.sizes())
  // Clothing sizes are named as the pickers name them: 46 is "S (44–46)".
  const bands = useMemo(() => clothingBands(sizes.data?.clothing ?? []), [sizes.data])
  const [filter, setFilter] = useState('')
  // Only those Create Order would flag for a missing size.
  const [onlyMissing, setOnlyMissing] = useState(missing)
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [sizing, setSizing] = useState<Employee | null>(null)
  const [actionError, setActionError] = useState<unknown>()
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

  const remove = async (e: Employee) => {
    if (!window.confirm(`Delete ${e.full_name}? Their past orders are kept.`)) return
    try {
      await client.employees.remove(e.id)
      employees.reload()
    } catch (err) {
      setActionError(err)
    }
  }

  return (
    <>
      <PageHeader
        title="Employees"
        description="Size defaults used when preparing future orders. Editing sizes never changes past orders."
        descriptionClassName="max-md:hidden"
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Add New Employee
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          enterKeyHint="search"
          placeholder="Search by name or code"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Search employees"
          data-shortcut="search"
          className="min-w-48 flex-1 md:max-w-sm md:flex-none"
        />
        {missingCount > 0 || onlyMissing ? (
          <div role="group" aria-label="Show" className="flex gap-2">
            <Button variant={onlyMissing ? 'outline' : 'secondary'} aria-pressed={!onlyMissing} onClick={() => setOnlyMissing(false)}>
              All · {employees.data?.length ?? 0}
            </Button>
            <Button variant={onlyMissing ? 'secondary' : 'outline'} aria-pressed={onlyMissing} onClick={() => setOnlyMissing((v) => !v)}>
              Missing a size · {missingCount}
            </Button>
          </div>
        ) : null}
      </div>
      {actionError ? <ErrorState title="Action failed" error={actionError} /> : null}
      {employees.error ? (
        <ErrorState error={employees.error} onRetry={employees.reload} />
      ) : employees.loading && !employees.data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState>
          {onlyMissing && !filter
            ? 'Every employee has the sizes Create Order needs.'
            : filter
              ? `No employees match “${filter.trim()}”.`
              : 'No employees yet. Use Add New Employee to add the first.'}
        </EmptyState>
      ) : (
        /*
          Where the table is narrow the employees are one list of two-line rows:
          name (a missing size flagged beside it), then code and saved sizes.
          A row opens the employee, whose page holds Edit Sizes, New order and
          Delete; the table keeps Edit Sizes and ⋯ on each row.
        */
        <Table stack="list" sortControl={<SortControl columns={columns} {...sortProps} />}>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <SortableHead key={c.key} column={c} {...sortProps} />
              ))}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((e) => {
              const missing = missingSizes(e)
              const flag = missingLabel(e)
              return (
                <TableRow
                  key={e.id}
                  className="cursor-pointer hover:bg-muted/50 stacked:grid stacked:grid-cols-[auto_minmax(0,1fr)_auto] stacked:gap-x-3 stacked:hover:bg-muted/50"
                  // The whole row opens the employee; the name is the real link, for keyboards,
                  // screen readers and "open in new tab". The row's own buttons keep their action.
                  onClick={(ev) => {
                    if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                    navigate({ name: 'employee', id: e.id })
                  }}
                >
                  <TableCell aria-hidden className="hidden stacked:col-start-1 stacked:flex stacked:[grid-row:1/span_2]">
                    <span className="flex size-9 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">{initials(e)}</span>
                  </TableCell>
                  <TableCell className="font-medium stacked:col-start-2 stacked:row-start-1 stacked:flex stacked:min-w-0 stacked:items-center stacked:justify-between stacked:gap-2">
                    <a {...linkTo({ name: 'employee', id: e.id }, navigate)} className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                      {e.full_name}
                    </a>
                    {/* Stacked, the sizes Create Order will ask for; the table flags them in their columns. */}
                    {flag ? (
                      <Badge variant="destructive" title="Create Order will ask for this size" className="hidden shrink-0 stacked:inline-flex">
                        {flag}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="hidden stacked:col-start-2 stacked:row-start-2 stacked:block stacked:text-xs stacked:text-muted-foreground">
                    {employeeFacts(e, bands) || 'No sizes saved'}
                  </TableCell>
                  <TableCell className="stacked:hidden">{e.code ?? '—'}</TableCell>
                  <TableCell className="stacked:hidden">{e.height_cm ? `${e.height_cm} cm` : '—'}</TableCell>
                  <TableCell className="stacked:hidden">{missing.clothing ? <MissingBadge /> : clothingSizeLabel(bands, e.clothing_size)}</TableCell>
                  <TableCell className="stacked:hidden">{missing.shoes ? <MissingBadge /> : formatSize(e.shoe_size)}</TableCell>
                  <TableCell aria-hidden className="hidden stacked:col-start-3 stacked:flex stacked:[grid-row:1/span_2]">
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap stacked:hidden">
                    <Button size="sm" variant="outline" onClick={() => setSizing(e)}>
                      Edit Sizes
                    </Button>{' '}
                    <MoreActions label={`More actions for ${e.full_name}`}>
                      <DropdownMenuItem onClick={() => setEditing(e)}>Edit details</DropdownMenuItem>
                      {session.canManageItems ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => void remove(e)}>
                            Delete employee…
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
    </>
  )
}

/** A size Create Order will flag: set it before ordering clothing or shoes. */
export function MissingBadge() {
  return (
    <Badge variant="destructive" title="Create Order will ask for this size">
      Missing
    </Badge>
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
  const { client } = useApi()
  const [height, setHeight] = useState('')
  const [clothing, setClothing] = useState('')
  const [shoe, setShoe] = useState('')
  const [error, setError] = useState<string>()
  const bands = clothingBands(sizes?.clothing ?? [])

  useEffect(() => {
    setHeight(employee?.height_cm?.toString() ?? '')
    setClothing(employee?.clothing_size?.toString() ?? '')
    setShoe(employee?.shoe_size ?? '')
    setError(undefined)
  }, [employee])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!employee) return
    const h = height.trim() === '' ? null : Number(height)
    if (h !== null && (!Number.isInteger(h) || h < 100 || h > 250)) {
      setError('Height must be 100–250 cm.')
      return
    }
    try {
      await client.employees.updateSizes(employee.id, { height_cm: h, clothing_size: clothing ? Number(clothing) : null, shoe_size: shoe || null })
      onSaved()
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <FormSheet
      open={employee !== null}
      onClose={onClose}
      title={`Edit Sizes: ${employee?.full_name ?? ''}`}
      description="Affects future orders only."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="sizes-form">
            Save
          </Button>
        </>
      }
    >
      <form id="sizes-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-3">
        <Field label="Height (cm)">{(p) => <Input {...controlProps(p)} inputMode="numeric" enterKeyHint="next" value={height} onChange={(e) => setHeight(e.target.value)} />}</Field>
        <Field label="Clothing size">
          {(p) => (
            <Select {...controlProps(p)} value={clothingBandValue(bands, clothing)} onChange={(e) => setClothing(e.target.value)}>
              <option value="">Not set</option>
              {bands.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Shoe size">
          {(p) => (
            <Select {...controlProps(p)} value={shoe} onChange={(e) => setShoe(e.target.value)}>
              <option value="">Not set</option>
              {sizes?.shoes.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {error ? <p role="alert" className="text-sm text-destructive sm:col-span-3">{error}</p> : null}
      </form>
    </FormSheet>
  )
}
