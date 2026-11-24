import { ApiError, type VaultDocument, type VaultSubjectKind, type VaultType } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { formatBytes } from '@ppe/backups'
import { Button } from '@ppe/ui/components/button'
import { DateInput } from '@ppe/ui/components/date-input'
import { Field, Input, Select, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { ActionError } from '@ppe/ui/components/states'
import { useAction } from '@ppe/ui/lib/use-action'
import { Paperclip, X } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'

import { EmployeePicker } from '@/components/employee-picker'
import { t } from '@/i18n'
import { type ChosenLink, VAULT_ACCEPT, detailsOf, draftProblems, fileProblem, typeLabel, uploadRefusal, uploadTypes, withLink } from '@/lib/vault'

/** What a sheet was opened to do: upload a new document (with links the place gives), or edit one. */
export type DocumentSheet = { kind: 'upload'; links: ChosenLink[]; type?: string } | { kind: 'edit'; document: VaultDocument } | { kind: 'version'; document: VaultDocument }

interface Draft {
  type: string
  title: string
  document_date: string | null
  valid_from: string | null
  valid_until: string | null
  links: ChosenLink[]
  note: string
}

/** The API's words for a refusal, or the error itself. */
const refusal = (err: unknown) => (err instanceof ApiError ? (uploadRefusal(err.status) ?? err) : err)

/**
 * Upload Document… and Edit…: the type (upload only), title, dates, links and,
 * for an upload, the file and a note. A link the place gave (the employee's
 * page) stays; the user adds employees with the picker. Checked here first
 * (lib/vault.ts), then by the API.
 */
export function DocumentDetailsSheet({
  sheet,
  types,
  onClose,
  onSaved,
}: {
  sheet: Extract<DocumentSheet, { kind: 'upload' | 'edit' }> | null
  types: readonly VaultType[] | undefined
  onClose: () => void
  onSaved: (d: VaultDocument, message: string) => void
}) {
  const { client } = useApi()
  const session = useSession()
  const formId = useId()
  const save = useAction()
  const fileInput = useRef<HTMLInputElement>(null)
  // The title the sheet took from a file, which a later file may replace; one the user typed it keeps.
  const named = useRef('')
  const editing = sheet?.kind === 'edit' ? sheet.document : null
  const given = sheet?.kind === 'upload' ? sheet.links.map((l) => l.kind) : []
  const offered = uploadTypes(types ?? [], (p) => session.can(p as never), given as VaultSubjectKind[])
  const [d, setD] = useState<Draft>(() => blank(sheet, offered))
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string>()
  const [tried, setTried] = useState(false)
  const [badDates, setBadDates] = useState<Partial<Record<'document_date' | 'valid_from' | 'valid_until', string>>>({})

  // A new sheet starts afresh.
  useEffect(() => {
    if (!sheet) return
    setD(blank(sheet, offered))
    setFile(null)
    setFileError(undefined)
    setTried(false)
    setBadDates({})
    named.current = ''
    save.clear()
  }, [sheet])

  const type = (types ?? []).find((ty) => ty.key === (editing?.type ?? d.type))
  const problems = draftProblems(d, type)
  const shown = tried ? problems : {}
  const missingFile = !editing && !file ? t.vault.fileRequired : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (Object.keys(problems).length > 0 || Object.values(badDates).some(Boolean) || (!editing && (!file || fileError))) return
    const details = {
      title: d.title.trim(),
      document_date: d.document_date,
      valid_from: d.valid_from,
      valid_until: d.valid_until,
      links: d.links.map(({ kind, id }) => ({ kind, id })),
    }
    await save.run(
      async () => {
        const saved = editing ? await client.vault.update(editing.id, details) : await client.vault.upload(d.type, details, file as File, d.note.trim())
        onSaved(saved, editing ? t.vault.saved : t.vault.uploaded(saved.title))
      },
      { mapError: refusal },
    )
  }

  const choose = (f: File | undefined) => {
    if (!f) return
    const problem = fileProblem(f, type?.max_bytes)
    setFile(f)
    setFileError(problem ?? undefined)
    // A new document is named after an accepted file until the user names it.
    if (editing || problem) return
    const title = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
    setD((cur) => {
      if (cur.title.trim() !== '' && cur.title !== named.current) return cur
      named.current = title
      return { ...cur, title }
    })
  }

  const dateField = (key: 'document_date' | 'valid_from' | 'valid_until', label: string) => (
    <Field label={label} error={badDates[key] ?? (key === 'valid_until' ? shown.valid_until : undefined)}>
      {(p) => (
        <DateInput
          {...controlProps(p)}
          value={d[key] ?? ''}
          onChange={(v, problem) => {
            setD((cur) => ({ ...cur, [key]: v || null }))
            setBadDates((b) => ({ ...b, [key]: problem }))
          }}
        />
      )}
    </Field>
  )

  return (
    <FormSheet
      open={sheet !== null}
      onClose={onClose}
      title={editing ? t.vault.editTitle : t.vault.uploadTitle}
      info={editing ? undefined : t.vault.info}
      footer={<FormSheetActions form={formId} onCancel={onClose} busy={save.pending} submitLabel={editing ? undefined : t.vault.uploadShort} />}
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="grid gap-4 sm:grid-cols-2" noValidate>
        {editing ? null : (
          <>
            <Field label={t.vault.type} required className="sm:col-span-2">
              {(p) => (
                <Select {...controlProps(p)} value={d.type} onChange={(e) => setD((cur) => ({ ...cur, type: e.target.value }))}>
                  {offered.map((ty) => (
                    <option key={ty.key} value={ty.key}>
                      {typeLabel(ty.key)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t.vault.file} required hint={t.vault.fileHint} error={tried ? (fileError ?? missingFile) : fileError} className="sm:col-span-2">
              {(p) => (
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept={VAULT_ACCEPT}
                    className="hidden"
                    aria-label={t.vault.chooseFile}
                    onChange={(e) => choose(e.target.files?.[0])}
                  />
                  <Button id={p.id} type="button" variant="outline" aria-describedby={p.describedBy} onClick={() => fileInput.current?.click()}>
                    <Paperclip aria-hidden /> {t.vault.chooseFile}
                  </Button>
                  {file ? (
                    <span className="min-w-0 truncate text-sm">
                      {file.name} <span className="text-muted-foreground">· {formatBytes(file.size)}</span>
                    </span>
                  ) : null}
                </div>
              )}
            </Field>
          </>
        )}
        <Field label={t.vault.titleLabel} required error={shown.title} className="sm:col-span-2">
          {(p) => <Input {...controlProps(p)} value={d.title} maxLength={200} onChange={(e) => setD((cur) => ({ ...cur, title: e.target.value }))} />}
        </Field>
        {type?.dated !== false ? dateField('document_date', t.vault.documentDate) : null}
        {type?.expiring ? (
          <>
            {dateField('valid_from', t.vault.validFrom)}
            {dateField('valid_until', t.vault.validUntil)}
          </>
        ) : null}
        <fieldset className="grid gap-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">{t.vault.linkedTo}</legend>
          {d.links.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {d.links.map((l) => (
                <li key={`${l.kind}:${l.id}`} className="flex items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-3 text-sm">
                  <span className="text-muted-foreground">{t.vault.kinds[l.kind]}:</span> {l.label}
                  {l.fixed ? null : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t.vault.removeLink(l.label)}
                      onClick={() => setD((cur) => ({ ...cur, links: cur.links.filter((x) => x !== l) }))}
                    >
                      <X aria-hidden className="size-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {type?.links.includes('employee') ?? true ? (
            <EmployeePicker
              label={t.vault.addLink}
              selected={null}
              onSelect={(e) => setD((cur) => ({ ...cur, links: withLink(cur.links, { kind: 'employee', id: e.id, label: e.full_name }) }))}
            />
          ) : null}
          {shown.links ? (
            <p role="alert" className="text-sm text-destructive">
              {shown.links}
            </p>
          ) : null}
        </fieldset>
        {editing ? null : (
          <Field label={t.vault.note} hint={t.vault.noteHint} className="sm:col-span-2">
            {(p) => <Textarea {...controlProps(p)} rows={2} maxLength={500} value={d.note} onChange={(e) => setD((cur) => ({ ...cur, note: e.target.value }))} />}
          </Field>
        )}
      </form>
      <ActionError error={save.error} />
    </FormSheet>
  )
}

/** The draft a sheet opens with: an upload's first offered type (or the place's), the given links; an edit's document. */
function blank(sheet: Extract<DocumentSheet, { kind: 'upload' | 'edit' }> | null, offered: readonly VaultType[]): Draft {
  if (sheet?.kind === 'edit') {
    const det = detailsOf(sheet.document)
    const labels = new Map(sheet.document.links.map((l) => [`${l.kind}:${l.id}`, l.label]))
    return {
      type: sheet.document.type,
      ...det,
      links: det.links.map((l) => ({ ...l, label: labels.get(`${l.kind}:${l.id}`) ?? '' })),
      note: '',
    }
  }
  const wanted = sheet?.type && offered.some((ty) => ty.key === sheet.type) ? sheet.type : (offered[0]?.key ?? '')
  return { type: wanted, title: '', document_date: null, valid_from: null, valid_until: null, links: sheet?.links ?? [], note: '' }
}

/** Add Version…: a newer file of a document, and a note; the earlier versions stay. */
export function AddVersionSheet({
  document: doc,
  types,
  onClose,
  onSaved,
}: {
  document: VaultDocument | null
  types: readonly VaultType[] | undefined
  onClose: () => void
  onSaved: (d: VaultDocument, message: string) => void
}) {
  const { client } = useApi()
  const formId = useId()
  const save = useAction()
  const fileInput = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const type = (types ?? []).find((ty) => ty.key === doc?.type)
  const problem = file ? fileProblem(file, type?.max_bytes) : tried ? t.vault.fileRequired : null

  useEffect(() => {
    setFile(null)
    setNote('')
    setTried(false)
    save.clear()
  }, [doc])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (!doc || !file || fileProblem(file, type?.max_bytes)) return
    await save.run(
      async () => {
        const saved = await client.vault.addVersion(doc.id, file, note.trim())
        onSaved(saved, t.vault.versionAdded(saved.title))
      },
      { mapError: refusal },
    )
  }

  return (
    <FormSheet
      open={doc !== null}
      onClose={onClose}
      title={t.vault.addVersionTitle}
      description={t.vault.addVersionHint}
      footer={<FormSheetActions form={formId} onCancel={onClose} busy={save.pending} submitLabel={t.vault.uploadShort} />}
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
        <Field label={t.vault.file} required hint={t.vault.fileHint} error={problem ?? undefined}>
          {(p) => (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <input ref={fileInput} type="file" accept={VAULT_ACCEPT} className="hidden" aria-label={t.vault.chooseFile} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button id={p.id} type="button" variant="outline" aria-describedby={p.describedBy} onClick={() => fileInput.current?.click()}>
                <Paperclip aria-hidden /> {t.vault.chooseFile}
              </Button>
              {file ? (
                <span className="min-w-0 truncate text-sm">
                  {file.name} <span className="text-muted-foreground">· {formatBytes(file.size)}</span>
                </span>
              ) : null}
            </div>
          )}
        </Field>
        <Field label={t.vault.note} hint={t.vault.noteHint}>
          {(p) => <Textarea {...controlProps(p)} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </form>
      <ActionError error={save.error} />
    </FormSheet>
  )
}
