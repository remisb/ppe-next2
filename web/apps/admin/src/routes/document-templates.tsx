import type { DocumentTemplate, TemplateBlockType, TemplateField, TemplateFields, TemplateLanguage } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { BackButton } from '@ppe/ui/components/back-button'
import { Badge } from '@ppe/ui/components/badge'
import { Button, buttonVariants } from '@ppe/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ppe/ui/components/card'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { Field, Input, Select, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { ActionError, EmptyState, ErrorState, Loaded, Loading, PageHeader } from '@ppe/ui/components/states'
import { saveFile } from '@ppe/ui/lib/save-file'
import { useAction } from '@ppe/ui/lib/use-action'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowDown, ArrowUp, ChevronRight, Download, ExternalLink, Eye, Plus, Save, Trash2, Upload, X } from 'lucide-react'
import {
  type CSSProperties,
  type FocusEvent,
  type FormEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import { currentLang, t } from '@/i18n'
import {
  type AskedProblem,
  type BlockProblem,
  type EditAsked,
  type EditBlock,
  type ParagraphAlign,
  addColumn,
  addRow,
  askedField,
  askedKeyPattern,
  askedKinds,
  blockKinds,
  byType,
  draftKey,
  draftNumber,
  draftProblems,
  editAsked,
  editBody,
  editedVersion,
  insertField,
  limits,
  moveBlock,
  newAsked,
  newBlock,
  pdfBlob,
  previewFilename,
  printsNumber,
  removeColumn,
  removeRow,
  savedKey,
  setCell,
  templateLanguages,
  templateState,
  toAsked,
  toBody,
  validName,
} from '@/lib/document-templates'
import { type Route, linkTo } from '@/lib/router'

type DocumentTemplatesRoute = Extract<Route, { name: 'documentTemplates' }>

const noFields: TemplateFields = { fields: [], types: [] }

/** A document type's name in the language in use, its key when the app does not know it. */
const typeName = (key: string) => t.documentTemplates.types[key] ?? key

/**
 * Document Templates (/document-templates, document_templates.manage): the
 * templates documents are generated from, by type, and a template opened at
 * its own address (/document-templates/<id>) in a block editor, with its
 * fields, asked fields and a PDF preview drawn by the API. Rules in
 * lib/document-templates.ts; docs/specs/document-template-service.md.
 */
export function DocumentTemplatesPage({ route, navigate }: { route: DocumentTemplatesRoute; navigate: (to: Route) => void }) {
  const { client } = useApi()
  const session = useSession()
  const allowed = session.can('document_templates.manage')
  const fields = useLoad(() => (allowed ? client.documentTemplates.fields() : Promise.resolve(noFields)))
  const list = useLoad(() => (allowed ? client.documentTemplates.list() : Promise.resolve([])))

  if (!allowed) {
    return (
      <>
        <PageHeader title={t.documentTemplates.title} />
        <EmptyState>{t.documentTemplates.onlyManagers}</EmptyState>
      </>
    )
  }
  if (route.id) {
    return (
      <TemplateEditor
        key={route.id}
        id={route.id}
        fields={fields}
        onBack={() => navigate({ name: 'documentTemplates' })}
        onChanged={list.reload}
      />
    )
  }
  return <TemplateList list={list} fields={fields.data} navigate={navigate} onAdded={list.reload} />
}

/** Draft, Published vN, Published vN, draft vN+1, or Retired. */
function StateBadge({ template }: { template: DocumentTemplate }) {
  const s = templateState(template)
  const words = t.documentTemplates.state
  switch (s.kind) {
    case 'draft':
      return <Badge variant="warning">{words.draft}</Badge>
    case 'published':
      return <Badge variant="success">{words.published(s.version)}</Badge>
    case 'publishedWithDraft':
      return <Badge variant="success">{words.publishedWithDraft(s.version, s.draft)}</Badge>
    case 'retired':
      return <Badge variant="secondary">{words.retired}</Badge>
  }
}

function TemplateList({
  list,
  fields,
  navigate,
  onAdded,
}: {
  list: ReturnType<typeof useLoad<DocumentTemplate[]>>
  fields: TemplateFields | undefined
  navigate: (to: Route) => void
  onAdded: () => void
}) {
  const [adding, setAdding] = useState(false)
  const typeOrder = (fields?.types ?? []).map((ty) => ty.key)
  return (
    <>
      <PageHeader
        title={t.documentTemplates.title}
        description={t.documentTemplates.description}
        primary={{ label: t.documentTemplates.addTemplate, short: t.common.add, icon: Plus, onClick: () => setAdding(true), disabled: !fields }}
      />
      <Loaded load={list} emptyState={t.documentTemplates.noTemplates}>
        {(templates) => (
          <div className="grid gap-6 md:max-w-3xl">
            {byType(templates, typeOrder).map((group) => (
              <section key={group.type} aria-labelledby={`type-${group.type}`}>
                <h2 id={`type-${group.type}`} className="mb-2 text-base font-semibold">
                  {typeName(group.type)}
                </h2>
                <ul className="grid gap-2">
                  {group.templates.map((tpl) => (
                    <li key={tpl.id}>
                      <a
                        {...linkTo({ name: 'documentTemplates', id: tpl.id }, navigate)}
                        aria-label={t.documentTemplates.open(tpl.name)}
                        className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <span className="grid min-w-0 flex-1 gap-1">
                          <span className="font-medium break-words">{tpl.name}</span>
                          <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <StateBadge template={tpl} />
                            <span>{typeName(tpl.type)}</span>
                            <span aria-hidden>·</span>
                            <span>{t.documentTemplates.languages[tpl.language]}</span>
                          </span>
                        </span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Loaded>
      <AddTemplateSheet
        open={adding}
        types={fields?.types.map((ty) => ty.key) ?? []}
        onClose={() => setAdding(false)}
        onAdded={(tpl) => {
          setAdding(false)
          onAdded()
          navigate({ name: 'documentTemplates', id: tpl.id })
        }}
      />
    </>
  )
}

/** Add Template: its type, name and language; it starts as a draft, opened in the editor. */
function AddTemplateSheet({ open, types, onClose, onAdded }: { open: boolean; types: string[]; onClose: () => void; onAdded: (t: DocumentTemplate) => void }) {
  const { client } = useApi()
  const [type, setType] = useState('')
  const [name, setName] = useState('')
  const [language, setLanguage] = useState<TemplateLanguage>('lt')
  const [errors, setErrors] = useState<{ type?: string; name?: string }>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setType(types.length === 1 ? types[0]! : '')
    setName('')
    setLanguage(currentLang())
    setErrors({})
    setServerError(undefined)
  }, [open])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = validName(name)
    const found = {
      ...(type ? {} : { type: t.documentTemplates.chooseType }),
      ...(problem ? { name: problem === 'required' ? t.documentTemplates.nameRequired : t.documentTemplates.nameTooLong } : {}),
    }
    setErrors(found)
    setServerError(undefined)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      onAdded(await client.documentTemplates.create({ type, name: name.trim(), language }))
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) setErrors({ name: t.documentTemplates.nameTaken })
      else setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.documentTemplates.addTemplate}
      description={t.documentTemplates.addDescription}
      footer={<FormSheetActions form="add-template-form" onCancel={onClose} busy={busy} submitLabel={t.documentTemplates.addTemplate} />}
    >
      <form id="add-template-form" onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
        <Field label={t.documentTemplates.type} required error={errors.type}>
          {(p) => (
            <Select {...controlProps(p)} value={type} onChange={(e) => setType(e.target.value)}>
              <option value="" disabled>
                {t.documentTemplates.chooseType}
              </option>
              {types.map((k) => (
                <option key={k} value={k}>
                  {typeName(k)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <NameAndLanguage name={name} language={language} nameError={errors.name} onName={setName} onLanguage={setLanguage} />
        {serverError ? (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}

function NameAndLanguage({
  name,
  language,
  nameError,
  onName,
  onLanguage,
}: {
  name: string
  language: TemplateLanguage
  nameError: string | undefined
  onName: (v: string) => void
  onLanguage: (v: TemplateLanguage) => void
}) {
  return (
    <>
      <Field label={t.documentTemplates.name} required hint={t.documentTemplates.nameHint} error={nameError}>
        {(p) => <Input {...controlProps(p)} autoComplete="off" maxLength={limits.maxName + 20} value={name} onChange={(e) => onName(e.target.value)} />}
      </Field>
      <Field label={t.documentTemplates.language} hint={t.documentTemplates.languageHint}>
        {(p) => (
          <Select {...controlProps(p)} value={language} onChange={(e) => onLanguage(e.target.value as TemplateLanguage)}>
            {templateLanguages.map((l) => (
              <option key={l} value={l}>
                {t.documentTemplates.languages[l]}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  )
}

function TemplateEditor({
  id,
  fields,
  onBack,
  onChanged,
}: {
  id: string
  fields: ReturnType<typeof useLoad<TemplateFields>>
  onBack: () => void
  onChanged: () => void
}) {
  const { client } = useApi()
  const loaded = useLoad(() => client.documentTemplates.get(id), [id])
  const template = loaded.data
  // The app's fields are needed to tell a known field from a mistyped one.
  const appFields = fields.data?.fields

  if (!template || !appFields) {
    return (
      <>
        <BackButton className="mb-3" onClick={onBack}>
          {t.documentTemplates.title}
        </BackButton>
        {loaded.error ? (
          <ErrorState title={t.documentTemplates.notFound} error={loaded.error} onRetry={loaded.reload} />
        ) : fields.error ? (
          <ErrorState error={fields.error} onRetry={fields.reload} />
        ) : (
          <Loading />
        )}
      </>
    )
  }
  return (
    <TemplateForm
      key={template.id}
      template={template}
      appFields={appFields}
      onBack={onBack}
      onChanged={() => {
        loaded.reload()
        onChanged()
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// The text control a field from the Fields panel goes into: the last one focused.

interface FieldTarget {
  el: HTMLInputElement | HTMLTextAreaElement
  set: (value: string) => void
}

const TargetContext = createContext<(target: FieldTarget) => void>(() => {})

/** An onFocus that makes the control the Fields panel's target, writing through onChange. */
function useFieldTarget(onChange: (value: string) => void) {
  const register = useContext(TargetContext)
  const latest = useRef(onChange)
  latest.current = onChange
  return (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => register({ el: e.currentTarget, set: (v) => latest.current(v) })
}

/** A text of the template, in markup (**bold**, *italic*, {{field}}), with its label. */
function MarkupField({
  label,
  value,
  onChange,
  multiline = false,
  rows = 4,
  hint,
  error,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  rows?: number
  hint?: string | undefined
  error?: string | undefined
  className?: string | undefined
}) {
  const focus = useFieldTarget(onChange)
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(p) =>
        multiline ? (
          <Textarea {...controlProps(p)} rows={rows} value={value} onFocus={focus} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input {...controlProps(p)} autoComplete="off" value={value} onFocus={focus} onChange={(e) => onChange(e.target.value)} />
        )
      }
    </Field>
  )
}

/** A table cell's text: its label shown only where the cells are stacked. */
function MarkupCell({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const focus = useFieldTarget(onChange)
  return (
    <label className="grid min-w-0 gap-1">
      <span className="text-xs text-muted-foreground @lg:sr-only">{label}</span>
      <Input autoComplete="off" value={value} onFocus={focus} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

// ---------------------------------------------------------------------------
// The editor

/**
 * The template's draft as blocks and asked fields, the Fields panel, and its
 * actions: Save Draft, Preview, Publish…, Edit Details, Retire…. The draft
 * is held as the editor's markup and turned into the API's body when it is
 * saved, previewed or checked.
 */
function TemplateForm({
  template,
  appFields,
  onBack,
  onChanged,
}: {
  template: DocumentTemplate
  appFields: TemplateField[]
  onBack: () => void
  onChanged: () => void
}) {
  const { client } = useApi()
  const action = useAction()
  const start = editedVersion(template)
  const [blocks, setBlocks] = useState<EditBlock[]>(() => editBody(start?.body))
  const [asked, setAsked] = useState<EditAsked[]>(() => (start?.asked ?? []).map(editAsked))
  // Every problem is shown once Save, Preview or Publish has been tried; a mistyped field at once.
  const [tried, setTried] = useState(false)
  const [status, setStatus] = useState('')
  const [pdf, setPdf] = useState<Blob | null>(null)
  const [editingDetails, setEditingDetails] = useState(false)
  const [kind, setKind] = useState<TemplateBlockType>('paragraph')
  const [saving, setSaving] = useState(false)
  const target = useRef<FieldTarget | null>(null)
  const setTarget = useCallback((tg: FieldTarget) => {
    target.current = tg
  }, [])

  const body = useMemo(() => toBody(blocks), [blocks])
  const askedOut = useMemo(() => asked.map(toAsked), [asked])
  const dirty = draftKey(body, askedOut) !== savedKey(editedVersion(template))
  const hasDraft = template.versions.some((v) => v.state === 'draft')
  const problems = useMemo(() => draftProblems(blocks, asked, appFields), [blocks, asked, appFields])
  const words = t.documentTemplates

  const updateBlock = (id: string, fn: (b: EditBlock) => EditBlock) => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? fn(b) : b)))
    setStatus('')
  }
  const updateAsked = (id: string, patch: Partial<EditAsked>) => {
    setAsked((as) => as.map((a) => (a.id === id ? { ...a, ...patch } : a)))
    setStatus('')
  }

  /** Whether the draft may go to the API; else its problems are shown. */
  const ready = () => {
    setTried(true)
    if (problems.count > 0) {
      action.fail(new Error(problems.empty && problems.count === 1 ? words.emptyBody : words.fixProblems(problems.count)))
      return false
    }
    return true
  }

  const save = async () => {
    if (!ready()) return
    const number = draftNumber(template)
    setSaving(true)
    const done = await action.run(() => client.documentTemplates.saveDraft(template.id, body, askedOut))
    setSaving(false)
    if (done) {
      setStatus(words.draftSaved(number))
      onChanged()
    }
  }

  const preview = async () => {
    if (!ready()) return
    await action.run(async () => {
      const answer = await client.documentTemplates.preview({ body, asked: askedOut, language: template.language, name: template.name })
      setPdf(pdfBlob(answer.pdf))
    })
  }

  const publish = async () => {
    if (!ready()) return
    if (!printsNumber(body)) {
      action.fail(new Error(words.needsNumber))
      return
    }
    const number = draftNumber(template)
    const done = await action.run(
      async () => {
        if (dirty) await client.documentTemplates.saveDraft(template.id, body, askedOut)
        await client.documentTemplates.publish(template.id)
      },
      { confirm: words.publishQuestion(number) },
    )
    if (done) {
      setStatus(words.published(number))
      onChanged()
    }
  }

  const retire = async () => {
    if (await action.run(() => client.documentTemplates.retire(template.id), { confirm: words.retireQuestion(template.name) })) {
      setStatus(words.retired(template.name))
      onChanged()
    }
  }

  const insert = (key: string) => {
    const tg = target.current
    if (tg?.el.isConnected) {
      const el = tg.el
      const next = insertField(el.value, key, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.selectionStart ?? el.value.length)
      tg.set(next.text)
      // The cursor goes back, past the field, once React has written the value.
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(next.cursor, next.cursor)
      })
      return
    }
    void navigator.clipboard?.writeText(`{{${key}}}`).then(
      () => setStatus(words.copied(key)),
      () => undefined,
    )
  }

  const nothingToPublish = !dirty && !hasDraft
  const shown = (p: BlockProblem) => tried || p.kind === 'unknownField' || p.kind === 'notAField'

  return (
    <TargetContext.Provider value={setTarget}>
      <PageHeader
        title={template.name}
        back={{ label: words.title, onClick: onBack }}
        subtitle={
          <span className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StateBadge template={template} />
            <span>{typeName(template.type)}</span>
            <span aria-hidden>·</span>
            <span>{words.languages[template.language]}</span>
          </span>
        }
        secondary={[
          { label: words.preview, icon: Eye, onClick: () => void preview(), disabled: action.pending, showFrom: 'sm' },
          { label: words.publish, icon: Upload, onClick: () => void publish(), disabled: action.pending || nothingToPublish, showFrom: 'md' },
        ]}
        primary={{ label: saving ? t.common.saving : words.saveDraft, icon: Save, onClick: () => void save(), disabled: action.pending || !dirty }}
        more={<DropdownMenuItem onClick={() => setEditingDetails(true)}>{words.editDetails}</DropdownMenuItem>}
        moreAsk={
          template.retired ? undefined : (
            <DropdownMenuItem variant="destructive" onClick={() => void retire()}>
              {words.retire}
            </DropdownMenuItem>
          )
        }
      />
      <ActionError error={action.error} className="mb-4" />
      <p role="status" className="mb-3 text-sm empty:hidden">
        {status || (dirty ? words.unsaved : '')}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-8">
          <section aria-labelledby="blocks-title" className="grid gap-3">
            <div>
              <h2 id="blocks-title" className="text-lg font-semibold">
                {words.blocks}
              </h2>
              <p className="text-sm text-muted-foreground">{words.blocksIntro}</p>
            </div>
            {tried && problems.empty ? (
              <p role="alert" className="text-sm text-destructive">
                {words.emptyBody}
              </p>
            ) : null}
            <ol className="grid gap-3">
              {blocks.map((b, i) => (
                <BlockCard
                  key={b.id}
                  block={b}
                  index={i}
                  count={blocks.length}
                  problems={(problems.blocks[b.id] ?? []).filter(shown)}
                  onChange={(fn) => updateBlock(b.id, fn)}
                  onMove={(step) => setBlocks((bs) => moveBlock(bs, bs.findIndex((x) => x.id === b.id), step))}
                  onRemove={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))}
                />
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Field label={words.blockKind} hideLabel className="min-w-0 flex-1 sm:max-w-xs">
                {(p) => (
                  <Select {...controlProps(p)} value={kind} onChange={(e) => setKind(e.target.value as TemplateBlockType)}>
                    {blockKinds.map((k) => (
                      <option key={k} value={k}>
                        {words.kinds[k]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button variant="outline" onClick={() => setBlocks((bs) => [...bs, newBlock(kind)])}>
                <Plus aria-hidden /> {words.addBlock}
              </Button>
            </div>
          </section>

          <AskedSection
            asked={asked}
            problems={problems.asked}
            tried={tried}
            onAdd={() => setAsked((as) => [...as, newAsked(as)])}
            onChange={updateAsked}
            onRemove={(id) => setAsked((as) => as.filter((a) => a.id !== id))}
          />
        </div>

        <FieldsPanel appFields={appFields} asked={asked} onInsert={insert} />
      </div>

      <PreviewSheet pdf={pdf} name={template.name} onClose={() => setPdf(null)} />
      <DetailsSheet
        open={editingDetails}
        template={template}
        onClose={() => setEditingDetails(false)}
        onSaved={() => {
          setEditingDetails(false)
          setStatus(words.detailsSaved)
          onChanged()
        }}
      />
    </TargetContext.Provider>
  )
}

type Of<K extends EditBlock['type']> = Extract<EditBlock, { type: K }>

/** One block: its kind and number, Move up and down, Remove, and its kind's controls. */
function BlockCard({
  block,
  index,
  count,
  problems,
  onChange,
  onMove,
  onRemove,
}: {
  block: EditBlock
  index: number
  count: number
  problems: BlockProblem[]
  onChange: (fn: (b: EditBlock) => EditBlock) => void
  onMove: (step: -1 | 1) => void
  onRemove: () => void
}) {
  const words = t.documentTemplates
  const label = words.blockLabel(index + 1, words.kinds[block.type])
  const titleId = useId()
  const errorId = useId()
  const patch = (p: Partial<EditBlock>) => onChange((b) => ({ ...b, ...p }) as EditBlock)
  const update = <K extends EditBlock['type']>(fn: (b: Of<K>) => Of<K>) => onChange((b) => fn(b as Of<K>))

  return (
    <li aria-labelledby={titleId} aria-describedby={problems.length ? errorId : undefined} className="@container grid gap-3 rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-1">
        <h3 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {label}
        </h3>
        <Button size="icon-sm" variant="ghost" aria-label={words.moveUp(label)} title={words.moveUp(label)} disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp aria-hidden />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={words.moveDown(label)} title={words.moveDown(label)} disabled={index === count - 1} onClick={() => onMove(1)}>
          <ArrowDown aria-hidden />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={words.removeBlock(label)} title={words.removeBlock(label)} onClick={onRemove}>
          <Trash2 aria-hidden />
        </Button>
      </div>

      {block.type === 'heading' ? (
        <div className="grid gap-3 @md:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label={words.level}>
            {(p) => (
              <Select {...controlProps(p)} value={block.level} onChange={(e) => patch({ level: Number(e.target.value) as 1 | 2 | 3 })}>
                {([1, 2, 3] as const).map((l) => (
                  <option key={l} value={l}>
                    {words.levels[l]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <MarkupField label={words.text} value={block.text} onChange={(text) => patch({ text })} />
        </div>
      ) : null}

      {block.type === 'paragraph' ? (
        <>
          <MarkupField label={words.text} value={block.text} multiline rows={5} onChange={(text) => patch({ text })} />
          <Field label={words.align} className="@md:max-w-xs">
            {(p) => (
              <Select {...controlProps(p)} value={block.align} onChange={(e) => patch({ align: e.target.value as ParagraphAlign })}>
                {(['', 'center', 'justify'] as const).map((a) => (
                  <option key={a} value={a}>
                    {words.aligns[a]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      ) : null}

      {block.type === 'list' ? (
        <>
          <MarkupField label={words.items} hint={words.itemsHint} value={block.items} multiline rows={5} onChange={(items) => patch({ items })} />
          <Check label={words.numbered} checked={block.ordered} onChange={(ordered) => patch({ ordered })} />
        </>
      ) : null}

      {block.type === 'table' ? <TableControls block={block} update={update<'table'>} /> : null}

      {block.type === 'fields' ? (
        <>
          <p className="text-sm text-muted-foreground">{words.detailsIntro}</p>
          <ol className="grid gap-3">
            {block.pairs.map((pair, i) => (
              <li key={i} className="grid gap-2 @lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] @lg:items-end">
                <MarkupField
                  label={`${words.pairLabel} ${i + 1}`}
                  value={pair.label}
                  onChange={(v) => update<'fields'>((b) => ({ ...b, pairs: b.pairs.map((x, k) => (k === i ? { ...x, label: v } : x)) }))}
                />
                <MarkupField
                  label={`${words.pairValue} ${i + 1}`}
                  value={pair.value}
                  onChange={(v) => update<'fields'>((b) => ({ ...b, pairs: b.pairs.map((x, k) => (k === i ? { ...x, value: v } : x)) }))}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={words.removeRow(i + 1)}
                  title={words.removeRow(i + 1)}
                  onClick={() => update<'fields'>((b) => ({ ...b, pairs: b.pairs.filter((_, k) => k !== i) }))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ol>
          <div>
            <Button variant="outline" size="sm" onClick={() => update<'fields'>((b) => ({ ...b, pairs: [...b.pairs, { label: '', value: '' }] }))}>
              <Plus aria-hidden /> {words.addRow}
            </Button>
          </div>
        </>
      ) : null}

      {block.type === 'signatures' ? (
        <>
          <ol className="grid gap-3 @2xl:grid-cols-3">
            {block.signatures.map((s, i) => (
              <li key={i} className="grid content-start gap-2 rounded-md border border-border p-3">
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 text-sm font-medium">{words.signature(i + 1)}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={words.removeSignature(i + 1)}
                    title={words.removeSignature(i + 1)}
                    disabled={block.signatures.length <= 1}
                    onClick={() => update<'signatures'>((b) => ({ ...b, signatures: b.signatures.filter((_, k) => k !== i) }))}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
                <MarkupField
                  label={words.signatureLabel}
                  value={s.label}
                  onChange={(v) => update<'signatures'>((b) => ({ ...b, signatures: b.signatures.map((x, k) => (k === i ? { ...x, label: v } : x)) }))}
                />
                <MarkupField
                  label={words.signatureUnder}
                  hint={words.signatureUnderHint}
                  value={s.under}
                  onChange={(v) => update<'signatures'>((b) => ({ ...b, signatures: b.signatures.map((x, k) => (k === i ? { ...x, under: v } : x)) }))}
                />
              </li>
            ))}
          </ol>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={block.signatures.length >= limits.maxSignatures}
              onClick={() => update<'signatures'>((b) => ({ ...b, signatures: [...b.signatures, { label: '', under: '' }] }))}
            >
              <Plus aria-hidden /> {words.addSignature}
            </Button>
          </div>
        </>
      ) : null}

      {block.type === 'page_break' ? <p className="text-sm text-muted-foreground">{words.pageBreakNote}</p> : null}

      {block.type === 'spacer' ? (
        <Field label={words.height} hint={words.heightHint} className="@md:max-w-xs">
          {(p) => (
            <Input
              {...controlProps(p)}
              type="number"
              inputMode="numeric"
              min={1}
              max={limits.maxSpacer}
              value={Number.isNaN(block.height) ? '' : block.height}
              onChange={(e) => patch({ height: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
            />
          )}
        </Field>
      ) : null}

      {problems.length ? (
        <ul id={errorId} role="alert" className="grid gap-1 text-sm text-destructive">
          {problems.map((p, i) => (
            <li key={i}>{p.kind === 'unknownField' ? words.problems.unknownField(p.key) : words.problems[p.kind]}</li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/** A checkbox with its words, 44px tall. */
function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3">
      <input type="checkbox" className="size-5 shrink-0 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">{label}</span>
    </label>
  )
}

/** A table's header row, column widths and cells, with Add and Remove for rows and columns. */
function TableControls({ block, update }: { block: Of<'table'>; update: (fn: (b: Of<'table'>) => Of<'table'>) => void }) {
  const words = t.documentTemplates
  const cols = block.widths.length
  // The cells side by side where the block is wide enough, stacked with their labels where not.
  const grid = 'grid gap-2 @lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))_2.75rem] @lg:items-end'
  const style = { '--cols': cols } as CSSProperties
  return (
    <>
      <Check label={words.headerRow} checked={block.header} onChange={(header) => update((b) => ({ ...b, header }))} />
      <fieldset className="grid gap-1">
        <legend className="text-sm font-medium">{words.columns}</legend>
        <p className="text-xs text-muted-foreground">{words.widthsHint}</p>
        <div className={grid} style={style}>
          {block.widths.map((w, c) => (
            <div key={c} className="flex min-w-0 items-end gap-1">
              <label className="grid min-w-0 flex-1 gap-1">
                <span className="text-xs text-muted-foreground @lg:sr-only">{words.width(c + 1)}</span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={limits.minWidth}
                  max={limits.maxWidth}
                  value={Number.isNaN(w) ? '' : w}
                  onChange={(e) => {
                    const v = e.target.value === '' ? Number.NaN : Number(e.target.value)
                    update((b) => ({ ...b, widths: b.widths.map((x, k) => (k === c ? v : x)) }))
                  }}
                />
              </label>
              <Button
                size="icon"
                variant="ghost"
                aria-label={words.removeColumn(c + 1)}
                title={words.removeColumn(c + 1)}
                disabled={cols <= 1}
                onClick={() => update((b) => removeColumn(b, c))}
              >
                <X aria-hidden />
              </Button>
            </div>
          ))}
        </div>
      </fieldset>
      <ol className="grid gap-3">
        {block.rows.map((row, r) => (
          <li key={r} className={cn(grid, '@max-lg:rounded-md @max-lg:border @max-lg:border-border @max-lg:p-2')} style={style} aria-label={words.row(r + 1)}>
            {row.map((cell, c) => (
              <MarkupCell key={c} label={words.cell(r + 1, c + 1)} value={cell} onChange={(v) => update((b) => setCell(b, r, c, v))} />
            ))}
            <Button
              size="icon"
              variant="ghost"
              aria-label={words.removeRow(r + 1)}
              title={words.removeRow(r + 1)}
              disabled={block.rows.length <= 1}
              onClick={() => update((b) => removeRow(b, r))}
            >
              <X aria-hidden />
            </Button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => update(addRow)}>
          <Plus aria-hidden /> {words.addRow}
        </Button>
        <Button variant="outline" size="sm" disabled={cols >= limits.maxColumns} onClick={() => update(addColumn)}>
          <Plus aria-hidden /> {words.addColumn}
        </Button>
      </div>
    </>
  )
}

/** The asked fields the template declares, each a row: key, label, kind, required, a choice's options. */
function AskedSection({
  asked,
  problems,
  tried,
  onAdd,
  onChange,
  onRemove,
}: {
  asked: EditAsked[]
  problems: Record<string, AskedProblem>
  tried: boolean
  onAdd: () => void
  onChange: (id: string, patch: Partial<EditAsked>) => void
  onRemove: (id: string) => void
}) {
  const words = t.documentTemplates
  return (
    <section aria-labelledby="asked-title" className="grid gap-3">
      <div>
        <h2 id="asked-title" className="text-lg font-semibold">
          {words.asked}
        </h2>
        <p className="text-sm text-muted-foreground">{words.askedIntro}</p>
      </div>
      {asked.length === 0 ? <p className="text-sm text-muted-foreground">{words.noAsked}</p> : null}
      <ol className="grid gap-3">
        {asked.map((a, i) => {
          const name = words.askedNamed(i + 1, a.label.trim())
          const problem = problems[a.id]
          // A problem under the control it is about: the key's as it is typed, the rest once saving has been tried.
          const errorFor = (part: 'key' | 'label' | 'options') => {
            if (!problem) return undefined
            const where = problem === 'key' || problem === 'keyTaken' ? 'key' : problem === 'label' || problem === 'labelLong' ? 'label' : 'options'
            return where === part && (part === 'key' || tried) ? words.askedProblems[problem] : undefined
          }
          return (
            <li key={a.id} className="@container grid gap-3 rounded-lg border border-border bg-card p-3 sm:p-4">
              <div className="flex items-center gap-1">
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                  {name} <span className="font-mono text-xs font-normal text-muted-foreground">{`{{${askedField(a.key)}}}`}</span>
                </h3>
                <Button size="icon-sm" variant="ghost" aria-label={words.removeAsked(name)} title={words.removeAsked(name)} onClick={() => onRemove(a.id)}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
              <div className="grid gap-3 @lg:grid-cols-2">
                <Field label={words.askedKey} hint={words.askedKeyHint} error={errorFor('key')}>
                  {(p) => (
                    <Input
                      {...controlProps(p)}
                      className="font-mono"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="off"
                      maxLength={40}
                      value={a.key}
                      onChange={(e) => onChange(a.id, { key: e.target.value })}
                    />
                  )}
                </Field>
                <Field label={words.askedLabel} hint={words.askedLabelHint} error={errorFor('label')}>
                  {(p) => <Input {...controlProps(p)} autoComplete="off" value={a.label} onChange={(e) => onChange(a.id, { label: e.target.value })} />}
                </Field>
                <Field label={words.askedKind}>
                  {(p) => (
                    <Select {...controlProps(p)} value={a.kind} onChange={(e) => onChange(a.id, { kind: e.target.value as EditAsked['kind'] })}>
                      {askedKinds.map((k) => (
                        <option key={k} value={k}>
                          {words.askedKinds[k]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="flex items-end">
                  <Check label={words.required} checked={a.required} onChange={(required) => onChange(a.id, { required })} />
                </div>
                {a.kind === 'choice' ? (
                  <Field
                    label={words.options}
                    hint={words.optionsHint}
                    error={errorFor('options')}
                    className="@lg:col-span-2"
                  >
                    {(p) => <Textarea {...controlProps(p)} rows={3} value={a.options} onChange={(e) => onChange(a.id, { options: e.target.value })} />}
                  </Field>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
      <div>
        <Button variant="outline" disabled={asked.length >= limits.maxAsked} onClick={onAdd}>
          <Plus aria-hidden /> {words.addAsked}
        </Button>
      </div>
    </section>
  )
}

/** The fields to put in the text: the app's, then the asked ones; a click puts one where the cursor was. */
function FieldsPanel({ appFields, asked, onInsert }: { appFields: TemplateField[]; asked: EditAsked[]; onInsert: (key: string) => void }) {
  const words = t.documentTemplates
  const titleId = useId()
  const usable = asked.filter((a) => askedKeyPattern.test(a.key.trim()))
  const item = (key: string, about: string, title?: string) => (
    <li key={key}>
      <button
        type="button"
        aria-label={words.insert(about)}
        title={title}
        // Keeps the cursor in the text being typed in.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onInsert(key)}
        className="grid min-h-11 w-full cursor-pointer gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="font-mono text-xs break-all">{`{{${key}}}`}</span>
        <span className="text-xs text-muted-foreground">{about}</span>
      </button>
    </li>
  )
  return (
    <Card role="region" aria-labelledby={titleId} className="min-w-0 lg:sticky lg:top-[calc(var(--header-offset)+1rem)] lg:max-h-[calc(100dvh-var(--header-offset)-2rem)] lg:overflow-y-auto">
      <CardHeader>
        <CardTitle id={titleId}>{words.fields}</CardTitle>
        <CardDescription>{words.fieldsIntro}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FieldGroup title={words.appFields}>{appFields.map((f) => item(f.key, words.fieldText[f.key] ?? f.label, f.sample ? words.sample(f.sample) : undefined))}</FieldGroup>
        {usable.length ? <FieldGroup title={words.askedFields}>{usable.map((a) => item(askedField(a.key.trim()), a.label.trim() || a.key))}</FieldGroup> : null}
      </CardContent>
    </Card>
  )
}

function FieldGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id}>
      <h3 id={id} className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      <ul className="grid gap-0.5">{children}</ul>
    </div>
  )
}

/**
 * The draft drawn by the API, in the browser's own PDF viewer (Administration
 * has the staff app's policy, whose frame-src allows a blob: frame), with
 * Open in New Tab and Download PDF; a browser that shows no PDFs inline is
 * offered those two alone.
 */
function PreviewSheet({ pdf, name, onClose }: { pdf: Blob | null; name: string; onClose: () => void }) {
  const words = t.documentTemplates
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!pdf) return
    const u = URL.createObjectURL(pdf)
    setUrl(u)
    return () => {
      URL.revokeObjectURL(u)
      setUrl(null)
    }
  }, [pdf])
  const inline = typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false
  const filename = previewFilename(name)
  return (
    <FormSheet
      open={pdf !== null}
      onClose={onClose}
      title={words.previewTitle}
      description={words.previewIntro}
      wide={inline}
      footer={
        pdf && url ? (
          <>
            <a href={url} target="_blank" rel="noopener" className={cn(buttonVariants({ variant: 'outline' }))}>
              <ExternalLink aria-hidden /> {words.openInNewTab}
            </a>
            <Button variant="outline" onClick={() => saveFile(pdf, filename)}>
              <Download aria-hidden /> {words.downloadPdf}
            </Button>
          </>
        ) : null
      }
    >
      {url && inline ? (
        <iframe src={url} title={filename} className="h-full min-h-96 w-full rounded-md border border-border bg-muted" />
      ) : url ? (
        <p className="text-sm">{words.noInlinePdf}</p>
      ) : null}
    </FormSheet>
  )
}

/** Edit Details: the template's name and language; its type never changes. */
function DetailsSheet({ open, template, onClose, onSaved }: { open: boolean; template: DocumentTemplate; onClose: () => void; onSaved: () => void }) {
  const { client } = useApi()
  const [name, setName] = useState(template.name)
  const [language, setLanguage] = useState<TemplateLanguage>(template.language)
  const [nameError, setNameError] = useState<string>()
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(template.name)
    setLanguage(template.language)
    setNameError(undefined)
    setServerError(undefined)
  }, [open, template.name, template.language])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const problem = validName(name)
    setNameError(problem === 'required' ? t.documentTemplates.nameRequired : problem === 'tooLong' ? t.documentTemplates.nameTooLong : undefined)
    setServerError(undefined)
    if (problem) return
    setBusy(true)
    try {
      await client.documentTemplates.update(template.id, { name: name.trim(), language })
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) setNameError(t.documentTemplates.nameTaken)
      else setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.documentTemplates.editDetails}
      description={t.documentTemplates.editDetailsDescription}
      footer={<FormSheetActions form="template-details-form" onCancel={onClose} busy={busy} />}
    >
      <form id="template-details-form" onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
        <NameAndLanguage name={name} language={language} nameError={nameError} onName={setName} onLanguage={setLanguage} />
        {serverError ? (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}
