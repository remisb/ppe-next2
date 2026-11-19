import { Download } from 'lucide-react'
import { type FormEvent, useEffect, useId, useState } from 'react'

import { saveFile } from '../lib/save-file.ts'
import { errorText } from '../lib/use-load.ts'
import { type ExportColumn, type ExportFormat, exportFile, exportFileName } from '../lib/table-export.ts'
import { uiText } from '../text.ts'
import { Button } from './button.tsx'
import { FormSheet } from './form-sheet.tsx'
import { Segmented } from './segmented.tsx'

/**
 * Export: a file of a list's rows (the ticked ones, or all the screen shows),
 * the columns chosen, as Excel or CSV. Built in the browser from what the
 * screen loaded (or, for a list loaded page by page, every page matching its
 * filters: `matching`), so it holds nothing the reader could not see there.
 * `list` names the sheet, the workbook's tab and the file ("Employees 2026-11-19.xlsx").
 */
export function ExportSheet<T>({
  open,
  onClose,
  list,
  columns,
  shown,
  selected = [],
  matching,
}: {
  open: boolean
  onClose: () => void
  list: string
  /** In the file's order; `shown` ones start ticked. */
  columns: readonly ExportColumn<T>[]
  /** Every row the screen shows, in its order. */
  shown: readonly T[]
  /** The ticked rows, in the screen's order; none leaves out the choice. */
  selected?: readonly T[]
  /**
   * A list loaded page by page (Orders, SIM Cards): "All matching (count)"
   * instead of All shown, every page fetched in the screen's order when exporting.
   */
  matching?: { count: number; load: () => Promise<readonly T[]> } | undefined
}) {
  const t = uiText()
  const formId = useId()
  const [rows, setRows] = useState<'selected' | 'shown'>('shown')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const [format, setFormat] = useState<ExportFormat>('xlsx')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  // Each time it opens: the selection if there is one, the screen's columns.
  useEffect(() => {
    if (!open) return
    setRows(selected.length > 0 ? 'selected' : 'shown')
    setChosen(new Set(columns.filter((c) => c.shown).map((c) => c.key)))
    setError(undefined)
    // Only on opening: what the screen changes meanwhile is read when exporting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const useSelected = rows === 'selected' && selected.length > 0
  const out = useSelected ? selected : shown
  const count = useSelected || !matching ? out.length : matching.count
  const cols = columns.filter((c) => chosen.has(c.key))
  const toggle = (key: string, on: boolean) =>
    setChosen((cur) => {
      const next = new Set(cur)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (cols.length === 0 || count === 0 || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const rowsOut = useSelected || !matching ? out : await matching.load()
      saveFile(exportFile(format, cols, rowsOut, list), exportFileName(list, format))
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.exportTitle(list)}
      description={t.exportDescription}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" form={formId} disabled={cols.length === 0 || count === 0 || busy}>
            <Download aria-hidden />
            {busy ? t.exporting : t.exportCount(count)}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="grid gap-5">
        {selected.length > 0 ? (
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">{t.exportRows}</legend>
            {(['selected', 'shown'] as const).map((v) => (
              <label key={v} className="flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11">
                <input type="radio" name={`${formId}-rows`} className="size-4 accent-primary" checked={rows === v} onChange={() => setRows(v)} />
                {v === 'selected' ? t.exportSelected(selected.length) : matching ? t.exportAllMatching(matching.count) : t.exportAllShown(shown.length)}
              </label>
            ))}
          </fieldset>
        ) : null}
        <fieldset aria-labelledby={`${formId}-columns`}>
          <div className="mb-1 flex items-baseline gap-3">
            <span id={`${formId}-columns`} className="mr-auto text-sm font-medium">
              {t.exportColumns}
            </span>
            <Button type="button" size="sm" variant="link" className="h-auto p-0" onClick={() => setChosen(new Set(columns.map((c) => c.key)))}>
              {t.exportAll}
            </Button>
            <Button type="button" size="sm" variant="link" className="h-auto p-0" onClick={() => setChosen(new Set())}>
              {t.exportNone}
            </Button>
          </div>
          {/* Two columns from sm, read down: the file's order. */}
          <div className="gap-x-4 sm:columns-2">
            {columns.map((c) => (
              <label key={c.key} className="flex min-h-9 break-inside-avoid items-center gap-2 text-sm pointer-coarse:min-h-11">
                <input type="checkbox" className="size-4 accent-primary" checked={chosen.has(c.key)} onChange={(e) => toggle(c.key, e.target.checked)} />
                {c.label}
              </label>
            ))}
          </div>
          {cols.length === 0 ? (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {t.exportNoColumns}
            </p>
          ) : null}
        </fieldset>
        <div className="grid gap-2">
          <span className="text-sm font-medium">{t.exportFormat}</span>
          <Segmented
            label={t.exportFormat}
            layout="fit"
            options={[
              // The formats' own names, the same in every language.
              { value: 'xlsx', label: 'Excel (.xlsx)' },
              { value: 'csv', label: 'CSV' },
            ]}
            value={format}
            onChange={setFormat}
          />
          <p className="text-sm text-muted-foreground">{t.exportFormatHelp}</p>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}
