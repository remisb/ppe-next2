import type { CatalogueItem, ItemSet } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, Input, Select, Textarea, controlProps } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { useApi, useSession } from '@/lib/api'
import { errorText, useLoad } from '@/lib/use-load'

/**
 * Item Sets: reusable lists of catalogue items with default quantities. A set
 * stores no sizes, prices or service periods; applying it resolves them fresh.
 */
export function ItemSets() {
  const { client } = useApi()
  const { canManageItems } = useSession()
  const sets = useLoad(() => client.itemSets.list())
  const catalogue = useLoad(() => client.catalogue.list())
  const [editing, setEditing] = useState<ItemSet | 'new' | null>(null)
  const [actionError, setActionError] = useState<unknown>()

  const itemsById = useMemo(() => new Map((catalogue.data ?? []).map((i) => [i.id, i])), [catalogue.data])

  const remove = async (s: ItemSet) => {
    if (!window.confirm(`Delete item set "${s.name}"?`)) return
    try {
      await client.itemSets.remove(s.id)
      sets.reload()
    } catch (err) {
      setActionError(err)
    }
  }

  const error = sets.error ?? catalogue.error
  return (
    <>
      <PageHeader
        title="Item Sets"
        description="Presets for Apply Item Set. Sizes and prices are resolved fresh each time a set is applied."
        actions={
          canManageItems ? (
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden /> New Item Set
            </Button>
          ) : undefined
        }
      />
      {actionError ? <ErrorState title="Action failed" error={actionError} /> : null}
      {error ? (
        <ErrorState error={error} onRetry={() => { sets.reload(); catalogue.reload() }} />
      ) : !sets.data || !catalogue.data ? (
        <Loading />
      ) : sets.data.length === 0 ? (
        // The header's New Item Set is the next step; a second button would only repeat it.
        <EmptyState>No item sets yet.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sets.data.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {s.name}
                  {s.active ? null : <Badge variant="outline">Inactive</Badge>}
                </CardTitle>
                {s.description ? <p className="text-sm text-muted-foreground">{s.description}</p> : null}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm">
                  {s.lines.map((l) => {
                    const item = itemsById.get(l.catalogue_item_id)
                    return (
                      <li key={l.catalogue_item_id}>
                        {item?.name ?? 'Deleted item'} × {l.default_quantity}
                        {item && !item.active ? <span className="text-muted-foreground"> (inactive)</span> : null}
                      </li>
                    )
                  })}
                </ol>
                {canManageItems ? (
                  <div className="mt-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(s)}>
                      Delete
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <SetForm
        set={editing}
        catalogue={catalogue.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          sets.reload()
        }}
      />
    </>
  )
}

interface DraftLine {
  catalogue_item_id: string
  default_quantity: string
}

function SetForm({
  set,
  catalogue,
  onClose,
  onSaved,
}: {
  set: ItemSet | 'new' | null
  catalogue: CatalogueItem[]
  onClose: () => void
  onSaved: () => void
}) {
  const { client } = useApi()
  const existing = set !== 'new' && set !== null ? set : undefined
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [active, setActive] = useState(true)
  const [lines, setLines] = useState<DraftLine[]>([])
  const [adding, setAdding] = useState('')
  const [error, setError] = useState<string>()

  useEffect(() => {
    setName(existing?.name ?? '')
    setDescription(existing?.description ?? '')
    setActive(existing?.active ?? true)
    setLines(existing?.lines.map((l) => ({ catalogue_item_id: l.catalogue_item_id, default_quantity: String(l.default_quantity) })) ?? [])
    setAdding('')
    setError(undefined)
  }, [set, existing])

  const nameOf = (id: string) => catalogue.find((i) => i.id === id)?.name ?? 'Deleted item'
  const available = catalogue.filter((i) => !lines.some((l) => l.catalogue_item_id === i.id))
  const qtyInvalid = lines.some((l) => !/^[1-9]\d*$/.test(l.default_quantity))

  const move = (i: number, d: -1 | 1) =>
    setLines((ls) => {
      const next = [...ls]
      const j = i + d
      if (j < 0 || j >= next.length) return ls
      ;[next[i], next[j]] = [next[j]!, next[i]!]
      return next
    })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (qtyInvalid) return
    const input = {
      name,
      description,
      active,
      lines: lines.map((l) => ({ catalogue_item_id: l.catalogue_item_id, default_quantity: Number(l.default_quantity) })),
    }
    try {
      if (existing) await client.itemSets.update(existing.id, input)
      else await client.itemSets.create(input)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError && err.isConflict ? 'An item set with this name already exists.' : errorText(err))
    }
  }

  return (
    <FormSheet
      open={set !== null}
      onClose={onClose}
      title={existing ? 'Edit Item Set' : 'New Item Set'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="set-form" disabled={!name.trim() || lines.length === 0 || qtyInvalid}>
            Save
          </Button>
        </>
      }
    >
      <form id="set-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name" required>{(p) => <Input {...controlProps(p)} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Description">{(p) => <Textarea {...controlProps(p)} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="size-5 accent-primary" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (offered in Create Order)
        </label>

        <div>
          <p className="mb-2 text-sm font-medium">Items, in display order</p>
          <ul className="flex flex-col gap-2">
            {lines.map((l, i) => (
              <li key={l.catalogue_item_id} className="flex items-center gap-1 rounded-md border border-border py-1 pr-1 pl-3 sm:gap-2">
                <span className="min-w-0 flex-1 text-sm break-words">{nameOf(l.catalogue_item_id)}</span>
                <Input
                  aria-label={`Default quantity for ${nameOf(l.catalogue_item_id)}`}
                  className="w-16 shrink-0 sm:w-20"
                  inputMode="numeric"
                  invalid={!/^[1-9]\d*$/.test(l.default_quantity)}
                  value={l.default_quantity}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, default_quantity: e.target.value } : x)))}
                />
                <Button type="button" size="icon" variant="ghost" aria-label={`Move ${nameOf(l.catalogue_item_id)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp aria-hidden />
                </Button>
                <Button type="button" size="icon" variant="ghost" aria-label={`Move ${nameOf(l.catalogue_item_id)} down`} disabled={i === lines.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown aria-hidden />
                </Button>
                <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${nameOf(l.catalogue_item_id)}`} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Select aria-label="Item to add" className="min-w-0 flex-1" value={adding} onChange={(e) => setAdding(e.target.value)}>
              <option value="">Choose an item…</option>
              {available.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.active ? '' : ' (inactive)'}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outline"
              disabled={!adding}
              onClick={() => {
                setLines((ls) => [...ls, { catalogue_item_id: adding, default_quantity: '1' }])
                setAdding('')
              }}
            >
              Add
            </Button>
          </div>
          {qtyInvalid ? <p className="mt-2 text-xs text-destructive">Quantities must be whole numbers of at least 1.</p> : null}
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </form>
    </FormSheet>
  )
}
