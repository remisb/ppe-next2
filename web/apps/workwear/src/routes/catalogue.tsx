import type { CatalogueItem, CatalogueItemInput, SizeGroup } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { Plus } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'

import { ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, controlProps } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi, useSession } from '@/lib/api'
import { errorText, useLoad } from '@/lib/use-load'
import { formatEuro, formatMonths, parseEuro } from '@/lib/utils'

export const sizeGroupLabel: Record<SizeGroup, string> = { CLOTHING: 'Clothing', SHOES: 'Shoes', NONE: 'No size' }

export function Catalogue() {
  const { client } = useApi()
  const { canManageItems } = useSession()
  const items = useLoad(() => client.catalogue.list())
  const [editing, setEditing] = useState<CatalogueItem | 'new' | null>(null)
  const [actionError, setActionError] = useState<unknown>()

  const toggle = async (i: CatalogueItem) => {
    try {
      await client.catalogue.setActive(i.id, !i.active)
      items.reload()
    } catch (err) {
      setActionError(err)
    }
  }

  return (
    <>
      <PageHeader
        title="Item Catalogue"
        description="Current names, prices and service periods. Orders keep the values they were placed with."
        actions={
          canManageItems ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> Add Item
            </Button>
          ) : undefined
        }
      />
      {actionError ? <ErrorState title="Action failed" error={actionError} /> : null}
      {items.error ? (
        <ErrorState error={items.error} onRetry={items.reload} />
      ) : items.loading && !items.data ? (
        <Loading />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Size group</TableHead>
              <TableHead className="text-right">Unit price</TableHead>
              <TableHead>Service period</TableHead>
              <TableHead>Status</TableHead>
              {canManageItems ? <TableHead className="text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.data?.map((i) => (
              <TableRow key={i.id} className={i.active ? undefined : 'text-muted-foreground'}>
                <TableCell className="font-medium">{i.name}</TableCell>
                <TableCell>{i.details || '—'}</TableCell>
                <TableCell>{sizeGroupLabel[i.size_group]}</TableCell>
                <TableCell className="text-right">{formatEuro(i.unit_price_cents)}</TableCell>
                <TableCell>{formatMonths(i.service_period_months)}</TableCell>
                <TableCell className="space-x-1">
                  {i.active ? <Badge variant="secondary">Active</Badge> : <Badge variant="outline">Inactive</Badge>}
                  {i.unit_price_cents === null || i.service_period_months === null ? (
                    <Badge variant="destructive">Incomplete</Badge>
                  ) : null}
                </TableCell>
                {canManageItems ? (
                  <TableCell className="space-x-1 text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(i)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void toggle(i)}>
                      {i.active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ItemForm
        item={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          items.reload()
        }}
      />
    </>
  )
}

function ItemForm({ item, onClose, onSaved }: { item: CatalogueItem | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { client } = useApi()
  const existing = item !== 'new' && item !== null ? item : undefined
  const [name, setName] = useState('')
  const [details, setDetails] = useState('')
  const [group, setGroup] = useState<SizeGroup>('NONE')
  const [price, setPrice] = useState('')
  const [period, setPeriod] = useState('')
  const [rank, setRank] = useState('1000')
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string>()

  useEffect(() => {
    setName(existing?.name ?? '')
    setDetails(existing?.details ?? '')
    setGroup(existing?.size_group ?? 'NONE')
    setPrice(existing?.unit_price_cents != null ? (existing.unit_price_cents / 100).toFixed(2) : '')
    setPeriod(existing?.service_period_months?.toString() ?? '')
    setRank(existing?.display_rank.toString() ?? '1000')
    setActive(existing?.active ?? true)
    setError(undefined)
  }, [item, existing])

  const priceCents = parseEuro(price)
  const priceError = Number.isNaN(priceCents) ? 'Enter a price like 49.99.' : undefined
  const months = period.trim() === '' ? null : Number(period)
  const periodError = months !== null && (!Number.isInteger(months) || months < 1) ? 'Whole months, at least 1.' : undefined
  const rankNum = Number(rank)
  const rankError = !Number.isInteger(rankNum) || rankNum < 0 ? 'A whole number, 0 or more.' : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (priceError || periodError || rankError) return
    const input: CatalogueItemInput = {
      name,
      details,
      size_group: group,
      unit_price_cents: priceCents,
      service_period_months: months,
      active,
      display_rank: rankNum,
    }
    try {
      if (existing) await client.catalogue.update(existing.id, input)
      else await client.catalogue.create(input)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError && err.isConflict ? 'An item with this name already exists.' : errorText(err))
    }
  }

  return (
    <FormSheet
      open={item !== null}
      onClose={onClose}
      title={existing ? 'Edit Item' : 'Add Item'}
      description="An item without a price or service period cannot be ordered until both are set."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="item-form" disabled={!name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form id="item-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Item name" required>{(p) => <Input {...controlProps(p)} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Manufacturer / model">{(p) => <Input {...controlProps(p)} value={details} onChange={(e) => setDetails(e.target.value)} />}</Field>
        <Field label="Size group" hint="Clothing and shoe items take the employee's size; no-size items (gloves, helmets) have none.">
          {(p) => (
            <Select {...controlProps(p)} value={group} onChange={(e) => setGroup(e.target.value as SizeGroup)}>
              {(Object.keys(sizeGroupLabel) as SizeGroup[]).map((g) => (
                <option key={g} value={g}>
                  {sizeGroupLabel[g]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Unit price (€)" error={priceError}>{(p) => <Input {...controlProps(p)} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}</Field>
        <Field label="Service period (months)" error={periodError}>{(p) => <Input {...controlProps(p)} inputMode="numeric" value={period} onChange={(e) => setPeriod(e.target.value)} />}</Field>
        <Field label="Display order" hint="Lower comes first in Add Item." error={rankError}>
          {(p) => <Input {...controlProps(p)} inputMode="numeric" value={rank} onChange={(e) => setRank(e.target.value)} />}
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (offered in Add Item)
        </label>
        {error ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
      </form>
    </FormSheet>
  )
}
