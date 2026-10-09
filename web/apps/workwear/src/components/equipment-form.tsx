import type { Asset, AssetCategory } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { Field, Input, Select, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { errorText } from '@ppe/ui/lib/use-load'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'
import {
  type EquipmentDraft,
  type EquipmentErrors,
  categories,
  categoryLabel,
  categoryPrefix,
  checkEquipmentDraft,
  emptyEquipmentDraft,
  equipmentDraftOf,
} from '@/lib/assets'

/**
 * Add Asset and Edit for equipment and furniture (§15): one item at a time,
 * in the Office. Choosing the category suggests its next inventory number
 * (PC-, PH-, DRV-, FUR-, AST-, §16) until someone types their own.
 */
export function EquipmentForm({
  item,
  onClose,
  onSaved,
  onOpenExisting,
}: {
  /** 'new' for Add Asset, an item to Edit it, null when closed. */
  item: Asset | 'new' | null
  onClose: () => void
  onSaved: (saved: Asset, added: boolean) => void
  onOpenExisting: (id: string) => void
}) {
  const { client } = useApi()
  const existing = item !== 'new' && item !== null ? item : undefined
  const [draft, setDraft] = useState<EquipmentDraft>(emptyEquipmentDraft)
  const [errors, setErrors] = useState<EquipmentErrors>({})
  const [taken, setTaken] = useState<string | undefined | null>(null)
  const [failure, setFailure] = useState<string>()
  const [saving, setSaving] = useState(false)
  const numberTyped = useRef(false)

  useEffect(() => {
    if (item === null) return
    setDraft(existing ? equipmentDraftOf(existing) : emptyEquipmentDraft())
    setErrors({})
    setTaken(null)
    setFailure(undefined)
    numberTyped.current = existing !== undefined
  }, [item])

  const suggest = (category: AssetCategory) =>
    client.assets.nextNumber(categoryPrefix[category]).then(
      (n) => {
        if (!numberTyped.current) setDraft((d) => ({ ...d, inventoryNo: n }))
      },
      () => {},
    )

  const set = <K extends keyof EquipmentDraft>(k: K, v: EquipmentDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }))
    if (k === 'inventoryNo') setTaken(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const { errors: found, input } = checkEquipmentDraft(draft)
    setErrors(found)
    setFailure(undefined)
    if (!input) return
    setSaving(true)
    try {
      const saved = existing ? await client.assets.update(existing.id, input) : await client.assets.create({ ...input, kind: 'EQUIPMENT' })
      onSaved(saved, !existing)
    } catch (err) {
      if (err instanceof ApiError && err.isConflict && /inventory number/i.test(err.message)) setTaken(err.existingId)
      else setFailure(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormSheet
      open={item !== null}
      onClose={onClose}
      title={existing ? t.assets.editAsset : t.assets.addAsset}
      description={t.assets.equipmentFormDescription}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button type="submit" form="equipment-form" disabled={saving}>
            {saving ? t.common.saving : t.assets.saveAsset}
          </Button>
        </>
      }
    >
      <form id="equipment-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label={t.assets.name} required error={errors.name}>
            {(p) => <Input {...controlProps(p)} autoComplete="off" value={draft.name} onChange={(e) => set('name', e.target.value)} />}
          </Field>
        </div>
        <Field label={t.assets.category} required error={errors.category}>
          {(p) => (
            <Select
              {...controlProps(p)}
              value={draft.category}
              onChange={(e) => {
                const c = e.target.value as AssetCategory | ''
                set('category', c)
                if (c && !existing) void suggest(c)
              }}
            >
              <option value="" disabled>
                —
              </option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field label={t.assets.inventoryNo} required hint={t.assets.inventoryNoHintEquipment} error={errors.inventoryNo}>
            {(p) => (
              <Input
                {...controlProps(p)}
                invalid={p.invalid || taken !== null}
                autoComplete="off"
                className="font-mono"
                value={draft.inventoryNo}
                onChange={(e) => {
                  numberTyped.current = true
                  set('inventoryNo', e.target.value)
                }}
              />
            )}
          </Field>
          {taken !== null ? (
            <div role="alert" className="flex flex-wrap items-center gap-x-2 text-xs text-destructive">
              {t.assets.inventoryNoTakenItem}
              {taken ? (
                <button type="button" className="cursor-pointer font-medium underline underline-offset-4 pointer-coarse:min-h-11" onClick={() => onOpenExisting(taken)}>
                  {t.assets.openExistingItem}
                </button>
              ) : null}
              {!existing && draft.category ? (
                <button
                  type="button"
                  className="cursor-pointer font-medium underline underline-offset-4 pointer-coarse:min-h-11"
                  onClick={() => {
                    setTaken(null)
                    numberTyped.current = false
                    void suggest(draft.category as AssetCategory)
                  }}
                >
                  {t.assets.suggestAnother}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <Field label={t.assets.serialNo} hint={t.assets.serialNoHint}>
          {(p) => <Input {...controlProps(p)} autoComplete="off" className="font-mono" value={draft.serialNo} onChange={(e) => set('serialNo', e.target.value)} />}
        </Field>
        <Field label={t.assets.nonReturnValue} hint={t.assets.nonReturnValueHintEquipment} error={errors.value}>
          {(p) => <Input {...controlProps(p)} inputMode="decimal" placeholder="0.00" value={draft.value} onChange={(e) => set('value', e.target.value)} />}
        </Field>
        <div className="sm:col-span-2">
          <Field label={t.assets.comment} hint={t.assets.equipmentCommentHint}>
            {(p) => <Textarea {...controlProps(p)} rows={2} value={draft.comment} onChange={(e) => set('comment', e.target.value)} />}
          </Field>
        </div>
        {failure ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {failure}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}
