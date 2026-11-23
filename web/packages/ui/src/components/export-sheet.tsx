import { Download, Link2, Share2 } from 'lucide-react'
import { type FormEvent, type ReactNode, useEffect, useId, useState } from 'react'

import { formatDateTime } from '../lib/dates.ts'
import { saveFile } from '../lib/save-file.ts'
import { errorText } from '../lib/use-load.ts'
import { type ExportColumn, type ExportFormat, exportFile, exportFileName, exportText } from '../lib/table-export.ts'
import { uiText } from '../text.ts'
import { Button } from './button.tsx'
import { CopyButton } from './copy-button.tsx'
import { Field, Input, Textarea, controlProps } from './field.tsx'
import { FormSheet } from './form-sheet.tsx'
import { Segmented } from './segmented.tsx'

/**
 * Sharing a few rows (WARE-51), offered beside the file formats: Copy as Text
 * (built here, nothing stored) and Share Link (the screen's `link` makes it
 * through the API). Everyone may share; `files` says whether the reader may
 * also download Excel and CSV (Export data). At most `limit` rows.
 */
export interface ShareOptions<T> {
  /** Excel and CSV too (the reader holds Export data); without, the sheet only shares. */
  files: boolean
  /** The most rows Copy as Text and Share Link take. */
  limit: number
  /** The days a link may stay open, the first chosen by default. */
  days: readonly number[]
  /** The name Share Link proposes for these rows. */
  defaultName: (rows: readonly T[]) => string
  /** Share Link: makes the link of rows with the columns' keys and answers it. */
  link: (input: { name: string; columns: string[]; rows: readonly T[]; days: number }) => Promise<{ url: string; expires_at: string }>
  /** Shared Links, offered once a link is made. */
  onManage?: (() => void) | undefined
}

type Output = ExportFormat | 'text' | 'link'

/**
 * Export: a file of a list's rows (the ticked ones, or all the screen shows),
 * the columns chosen, as Excel or CSV. Built in the browser from what the
 * screen loaded (or, for a list loaded page by page, every page matching its
 * filters: `matching`), so it holds nothing the reader could not see there.
 * `list` names the sheet, the workbook's tab and the file ("Employees 2026-11-19.xlsx").
 * With `share`, it also offers Copy as Text and Share Link (ShareOptions).
 */
export function ExportSheet<T>({
  open,
  onClose,
  list,
  columns,
  shown,
  selected = [],
  matching,
  scope,
  onChangeRows,
  onExported,
  share,
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
  /**
   * The rows already chosen in select mode (ExportMode): the sheet shows them
   * as a summary with Change (`onChangeRows`, back to the list) instead of
   * asking. Without it, it offers Selected or All shown when rows are ticked.
   */
  scope?: 'selected' | 'all' | undefined
  onChangeRows?: (() => void) | undefined
  /** After the file is saved, the text copied or the link made (select mode ends then). */
  onExported?: (() => void) | undefined
  share?: ShareOptions<T> | undefined
}) {
  const t = uiText()
  const formId = useId()
  const files = !share || share.files
  const [rows, setRows] = useState<'selected' | 'shown'>('shown')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const [output, setOutput] = useState<Output>('xlsx')
  const [name, setName] = useState('')
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // After Share Link: the link, shown once; after Copy Link, its note.
  const [made, setMade] = useState<{ url: string; expires_at: string }>()
  const [linkNote, setLinkNote] = useState<string>()
  // After Copy as Text: the text as it pastes, and whether the browser copied it (else it is to copy by hand).
  const [copied, setCopied] = useState<{ text: string; rows: number; ok: boolean }>()

  const useSelected = rows === 'selected' && selected.length > 0
  const out = useSelected ? selected : shown
  const count = useSelected || !matching ? out.length : matching.count

  // Each time it opens: the selection if there is one, the screen's columns.
  useEffect(() => {
    if (!open) return
    setRows(scope ? (scope === 'selected' ? 'selected' : 'shown') : selected.length > 0 ? 'selected' : 'shown')
    setChosen(new Set(columns.filter((c) => c.shown).map((c) => c.key)))
    setOutput(files ? 'xlsx' : 'text')
    setDays(share?.days.includes(7) ? 7 : (share?.days[0] ?? 7))
    setName('')
    setError(undefined)
    setMade(undefined)
    setCopied(undefined)
    setLinkNote(undefined)
    // Only on opening: what the screen changes meanwhile is read when exporting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const sharing = output === 'text' || output === 'link'
  const tooMany = sharing && share !== undefined && count > share.limit
  const cols = columns.filter((c) => chosen.has(c.key))
  const linkName = name.trim() || (share ? share.defaultName(out) : '')
  const toggle = (key: string, on: boolean) =>
    setChosen((cur) => {
      const next = new Set(cur)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  const finish = () => {
    onClose()
    onExported?.()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (cols.length === 0 || count === 0 || busy || tooMany) return
    setBusy(true)
    setError(undefined)
    try {
      const rowsOut = useSelected || !matching ? out : await matching.load()
      if (output === 'text') {
        const text = exportText(list, cols, rowsOut)
        // No clipboard outside a secure context (http on another host): the text, to copy by hand.
        const copied = await (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'))).then(
          () => true,
          () => false,
        )
        setCopied({ text, rows: rowsOut.length, ok: copied })
      } else if (output === 'link' && share) {
        setMade(await share.link({ name: linkName, columns: cols.map((c) => c.key), rows: rowsOut, days }))
      } else if (output === 'xlsx' || output === 'csv') {
        saveFile(exportFile(output, cols, rowsOut, list), exportFileName(list, output))
        finish()
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const title = files ? t.exportTitle(list) : t.shareTitle(list)
  const description = !share ? t.exportDescription : files ? t.exportShareDescription : t.shareDescription

  // The link, once made: shown once, with Copy Link and the way to Shared Links.
  if (made) {
    return (
      <FormSheet open={open} onClose={finish} title={t.linkCreated} description={title} footer={<Button onClick={finish}>{t.done}</Button>}>
        <div className="grid gap-4">
          <div className="flex items-center gap-2">
            <Input readOnly value={made.url} aria-label={t.shareLink} onFocus={(e) => e.currentTarget.select()} className="font-mono text-sm" />
            <CopyButton text={made.url} label={t.copyLink} onCopied={(ok) => setLinkNote(ok ? t.linkCopied : t.copyFailed)} />
          </div>
          {linkNote ? (
            <p role="status" className="text-sm font-medium">
              {linkNote}
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{t.linkOpenUntil(formatDateTime(made.expires_at, undefined))}</p>
          {share?.onManage ? (
            <Button
              type="button"
              variant="link"
              className="h-auto justify-self-start p-0"
              onClick={() => {
                finish()
                share.onManage?.()
              }}
            >
              {t.openSharedLinks}
            </Button>
          ) : null}
        </div>
      </FormSheet>
    )
  }

  // The text, once copied: said, and shown as it will paste. Where the browser would
  // not copy (http on another host, a refused permission), the same text to copy by hand.
  if (copied) {
    return (
      <FormSheet open={open} onClose={finish} title={t.copyAsText} description={title} footer={<Button onClick={finish}>{t.done}</Button>}>
        <div className="grid gap-3">
          <p role={copied.ok ? 'status' : 'alert'} className={copied.ok ? 'text-sm font-medium' : 'text-sm text-destructive'}>
            {copied.ok ? t.textCopied(copied.rows) : t.copyFailed}
          </p>
          <Textarea
            readOnly
            rows={12}
            value={copied.text}
            aria-label={t.copyAsText}
            autoFocus={!copied.ok}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-sm"
          />
        </div>
      </FormSheet>
    )
  }

  const submitLabel = busy
    ? output === 'link'
      ? t.creatingLink
      : t.exporting
    : output === 'text'
      ? t.copyTextCount(count)
      : output === 'link'
        ? t.createLinkCount(count)
        : t.exportCount(count)
  const SubmitIcon = output === 'text' ? Share2 : output === 'link' ? Link2 : Download

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" form={formId} disabled={cols.length === 0 || count === 0 || busy || tooMany}>
            <SubmitIcon aria-hidden />
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="grid gap-5">
        {scope ? (
          // The rows were picked on the list: said, not asked; Change goes back to picking.
          <div className="flex min-h-11 items-center gap-2 rounded-md bg-muted px-3 text-sm">
            <span className="font-medium">
              {useSelected ? t.exportSummarySelected(count) : matching ? t.exportAllMatching(count) : t.exportAllShown(count)}
            </span>
            {onChangeRows ? (
              <Button type="button" size="sm" variant="link" className="ml-auto h-auto p-0" onClick={onChangeRows}>
                {t.exportChangeRows}
              </Button>
            ) : null}
          </div>
        ) : selected.length > 0 ? (
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
        {share ? (
          // How: the files (with Export data), then the two ways to share.
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">{t.output}</legend>
            {files ? (
              <OutputGroup title={t.outputDownload}>
                <OutputChoice name={formId} value="xlsx" current={output} onChange={setOutput} label="Excel (.xlsx)" />
                <OutputChoice name={formId} value="csv" current={output} onChange={setOutput} label="CSV" />
              </OutputGroup>
            ) : null}
            <OutputGroup title={t.outputShare}>
              <OutputChoice name={formId} value="text" current={output} onChange={setOutput} label={t.copyAsText} help={t.copyAsTextHelp} />
              <OutputChoice name={formId} value="link" current={output} onChange={setOutput} label={t.shareLink} help={t.shareLinkHelp} />
            </OutputGroup>
            {tooMany ? (
              <p role="alert" className="text-sm text-destructive">
                {t.shareTooMany(share.limit, count)}
              </p>
            ) : null}
          </fieldset>
        ) : null}
        {share && output === 'link' ? (
          <div className="grid gap-4">
            <Field label={t.shareName} hint={t.shareNameHelp}>
              {(p) => <Input {...controlProps(p)} value={name} placeholder={share.defaultName(out)} maxLength={100} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <div className="grid gap-2">
              <span className="text-sm font-medium">{t.shareDays}</span>
              <Segmented
                label={t.shareDays}
                layout="fit"
                options={share.days.map((d) => ({ value: String(d), label: t.shareDaysOption(d) }))}
                value={String(days)}
                onChange={(v) => setDays(Number(v))}
              />
            </div>
          </div>
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
        {share ? null : (
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
              value={output === 'csv' ? 'csv' : 'xlsx'}
              onChange={setOutput}
            />
            <p className="text-sm text-muted-foreground">{t.exportFormatHelp}</p>
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}

function OutputGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-md border border-border p-3">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</span>
      {children}
    </div>
  )
}

function OutputChoice({ name, value, current, onChange, label, help }: { name: string; value: Output; current: Output; onChange: (v: Output) => void; label: string; help?: string }) {
  return (
    <label className="flex min-h-9 items-start gap-2 py-1 text-sm pointer-coarse:min-h-11">
      <input type="radio" name={`${name}-output`} className="mt-0.5 size-4 shrink-0 accent-primary" checked={current === value} onChange={() => onChange(value)} />
      <span className="grid gap-0.5">
        <span>{label}</span>
        {help ? <span className="text-xs text-muted-foreground">{help}</span> : null}
      </span>
    </label>
  )
}
