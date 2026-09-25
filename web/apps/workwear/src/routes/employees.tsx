import type { Employee, Sizes } from '@ppe/api-client'
import { Plus } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { EmployeeForm } from '@/components/employee-form'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, controlProps } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, stackedBreak } from '@/components/ui/table'
import { useApi, useSession } from '@/lib/api'
import { errorText, useLoad } from '@/lib/use-load'
import { cn, formatSize } from '@/lib/utils'

export function Employees() {
  const { client } = useApi()
  const session = useSession()
  const employees = useLoad(() => client.employees.list())
  const sizes = useLoad(() => client.sizes())
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [sizing, setSizing] = useState<Employee | null>(null)
  const [actionError, setActionError] = useState<unknown>()

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (employees.data ?? []).filter((e) => !q || `${e.full_name} ${e.code ?? ''}`.toLowerCase().includes(q))
  }, [employees.data, filter])

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
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Add New Employee
          </Button>
        }
      />
      <div className="mb-4 md:max-w-sm">
        <Input
          type="search"
          enterKeyHint="search"
          placeholder="Search by name or code"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Search employees"
        />
      </div>
      {actionError ? <ErrorState title="Action failed" error={actionError} /> : null}
      {employees.error ? (
        <ErrorState error={employees.error} onRetry={employees.reload} />
      ) : employees.loading && !employees.data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState>
          {filter ? `No employees match “${filter.trim()}”.` : 'No employees yet. Use Add New Employee to add the first.'}
        </EmptyState>
      ) : (
        // Where the table is narrow each employee is a card: name and code, the three sizes side by side, then actions.
        <Table stack="grid">
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Height</TableHead>
              <TableHead>Clothing</TableHead>
              <TableHead>Shoes</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((e) => (
              <TableRow key={e.id} className={stackedBreak}>
                <TableCell className="font-medium stacked:order-1 stacked:w-auto stacked:flex-1 stacked:text-base stacked:font-semibold">{e.full_name}</TableCell>
                <TableCell label="Code" className={cn('stacked:order-1 stacked:w-auto', !e.code && 'stacked:hidden')}>
                  {e.code ?? '—'}
                </TableCell>
                <TableCell label="Height" className={sizeCell}>{e.height_cm ? `${e.height_cm} cm` : '—'}</TableCell>
                <TableCell label="Clothing" className={sizeCell}>{formatSize(e.clothing_size)}</TableCell>
                <TableCell label="Shoes" className={sizeCell}>{formatSize(e.shoe_size)}</TableCell>
                <TableCell className="space-x-1 text-right stacked:order-3 stacked:mt-2 stacked:flex stacked:flex-wrap stacked:justify-start stacked:gap-2 stacked:space-x-0 stacked:*:flex-auto">
                  <Button size="sm" variant="outline" onClick={() => setSizing(e)}>
                    Edit Sizes
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                    Edit
                  </Button>
                  {session.canManageItems ? (
                    <Button size="sm" variant="ghost" onClick={() => void remove(e)}>
                      Delete
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
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

/** Card: height, clothing and shoe size in three columns, label above value. */
const sizeCell = 'stacked:order-3 stacked:w-[calc((100%-2rem)/3)] stacked:flex-col stacked:items-start stacked:gap-0 stacked:pt-2 stacked:text-left stacked:font-medium'

/** Edit Sizes: changes defaults for future resolutions only. */
function EditSizes({
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

  useEffect(() => {
    setHeight(employee?.height_cm?.toString() ?? '')
    setClothing(employee?.clothing_size ?? '')
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
      await client.employees.updateSizes(employee.id, { height_cm: h, clothing_size: clothing || null, shoe_size: shoe || null })
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
            <Select {...controlProps(p)} value={clothing} onChange={(e) => setClothing(e.target.value)}>
              <option value="">Not set</option>
              {sizes?.clothing.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} ({s.min_cm}–{s.max_cm} cm)
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
