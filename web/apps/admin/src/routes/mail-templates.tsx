import type { MailField, MailMessage, MailTemplate, MailTemplateKey, MailText } from '@ppe/api-client'
import { RecordChanges } from '@ppe/audit'
import { useApi, useSession } from '@ppe/app-shell'
import { BackButton } from '@ppe/ui/components/back-button'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ppe/ui/components/card'
import { Field, Input, Textarea, controlProps } from '@ppe/ui/components/field'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { ErrorState, Loaded, Loading, PageHeader } from '@ppe/ui/components/states'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { ChevronRight } from 'lucide-react'
import { type FormEvent, useEffect, useId, useRef, useState } from 'react'

import { t } from '@/i18n'
import { type MailPart, type TextProblem, insertField, sameText, textProblems, tidyText, unknownFields } from '@/lib/mail-templates'
import { type Route, linkTo } from '@/lib/router'

type MailTemplatesRoute = Extract<Route, { name: 'mailTemplates' }>

/**
 * Mail Templates (/mail-templates, mail_templates.manage): the emails the app
 * prepares, one template each, and a template opened at its own address to
 * edit, with its fields and a preview with sample values. Nothing is sent
 * from the app; staff copy the prepared email into their own.
 */
export function MailTemplatesPage({ route, navigate }: { route: MailTemplatesRoute; navigate: (to: Route) => void }) {
  const { client } = useApi()
  const list = useLoad(() => client.mailTemplates.list())
  const timeZone = useLoad(() => client.settings()).data?.timezone

  if (route.key) {
    return <TemplateEditor key={route.key} templateKey={route.key} timeZone={timeZone} onBack={() => navigate({ name: 'mailTemplates' })} onSaved={list.reload} />
  }
  return (
    <>
      <PageHeader title={t.mailTemplates.title} description={t.mailTemplates.description} />
      <Loaded load={list}>
        {(templates) => (
          <ul className="grid gap-3 md:max-w-3xl">
            {templates.map((m) => (
              <li key={m.key}>
                <a
                  {...linkTo({ name: 'mailTemplates', key: m.key }, navigate)}
                  aria-label={t.mailTemplates.open(t.mailTemplates.names[m.key])}
                  className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t.mailTemplates.names[m.key]}</span>
                      <TemplateState template={m} timeZone={timeZone} />
                    </span>
                    <span className="text-sm text-muted-foreground">{t.mailTemplates.usedBy[m.key]}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{m.subject}</span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </>
  )
}

/** Default text, or Changed and when. */
function TemplateState({ template, timeZone }: { template: MailTemplate; timeZone: string | undefined }) {
  if (template.is_default) return <Badge variant="secondary">{t.mailTemplates.isDefault}</Badge>
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Badge variant="outline">{t.mailTemplates.changed}</Badge>
      {template.updated_at ? <RelativeDate iso={template.updated_at} timeZone={timeZone} /> : null}
    </span>
  )
}

function TemplateEditor({
  templateKey,
  timeZone,
  onBack,
  onSaved,
}: {
  templateKey: MailTemplateKey
  timeZone: string | undefined
  onBack: () => void
  onSaved: () => void
}) {
  const { client } = useApi()
  const session = useSession()
  const loaded = useLoad(() => client.mailTemplates.get(templateKey), [templateKey])
  const template = loaded.data

  return (
    <>
      {/* Once the template is drawn, the way back is in its header's row. */}
      {!template ? (
        <BackButton className="mb-3" onClick={onBack}>
          {t.mailTemplates.back}
        </BackButton>
      ) : null}
      {!template && loaded.error ? (
        <ErrorState title={t.mailTemplates.notFound} error={loaded.error} onRetry={loaded.reload} />
      ) : !template ? (
        <Loading />
      ) : (
        <>
          <PageHeader
            title={t.mailTemplates.names[template.key]}
            back={{ label: t.mailTemplates.back, onClick: onBack }}
            description={t.mailTemplates.usedBy[template.key]}
            subtitle={<TemplateState template={template} timeZone={timeZone} />}
          />
          <TemplateForm
            template={template}
            onSaved={() => {
              loaded.reload()
              onSaved()
            }}
          />
          {session.can('audit.read') ? (
            <RecordChanges
              className="mt-8 md:max-w-3xl"
              load={() => client.audit.list({ entity_type: 'mail_template', entity_id: template.entity_id }).then((p) => p.events)}
              deps={[template.entity_id, template.updated_at]}
              timeZone={timeZone}
              rememberAs="mail-template-changes"
            />
          ) : null}
        </>
      )}
    </>
  )
}

const textOf = (m: MailText): MailText => ({ to: m.to, cc: m.cc, subject: m.subject, body: m.body })

/** How long typing pauses before the preview is asked for again. */
const PREVIEW_DELAY_MS = 400

/**
 * The template's To, Subject and Message as a draft, its fields to put where
 * the cursor is, and the preview of the draft with sample values. Save keeps
 * it; Use Default Text puts the default in the draft, which Save keeps too.
 */
function TemplateForm({ template, onSaved }: { template: MailTemplate; onSaved: () => void }) {
  const { client } = useApi()
  const fieldsId = useId()
  const saved = textOf(template)
  const [draft, setDraft] = useState<MailText>(saved)
  const [problems, setProblems] = useState<Partial<Record<MailPart, TextProblem>>>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [preview, setPreview] = useState<{ message?: MailMessage; error?: string; loading: boolean }>({ loading: true })
  // The part a field goes into: the last one with the cursor, the message at first.
  const [part, setPart] = useState<MailPart>('body')
  const inputs = {
    to: useRef<HTMLInputElement>(null),
    cc: useRef<HTMLInputElement>(null),
    subject: useRef<HTMLInputElement>(null),
    body: useRef<HTMLTextAreaElement>(null),
  }
  const dirty = !sameText(draft, saved)
  const isDefaultText = sameText(draft, template.default)

  // The draft starts from what is saved, and again after each save.
  const savedKey = JSON.stringify(saved)
  useEffect(() => setDraft(saved), [savedKey])

  // The preview follows the draft once typing pauses; the server checks the fields.
  const draftKey = JSON.stringify(draft)
  useEffect(() => {
    let live = true
    setPreview((p) => ({ ...p, loading: true }))
    const timer = window.setTimeout(() => {
      if (Object.keys(textProblems(draft)).length > 0) {
        setPreview({ loading: false })
        return
      }
      client.mailTemplates.preview(template.key, tidyText(draft)).then(
        (message) => live && setPreview({ message, loading: false }),
        (err) => live && setPreview({ error: errorText(err), loading: false }),
      )
    }, PREVIEW_DELAY_MS)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [draftKey, template.key])

  const change = (next: MailText) => {
    setDraft(next)
    setDone(false)
    setServerError(undefined)
    setProblems({})
  }

  const type = (p: MailPart, value: string) => change({ ...draft, [p]: value })

  const insert = (field: MailField) => {
    const el = inputs[part].current
    const value = draft[part]
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? start
    const next = insertField(value, field.key, start, end)
    type(part, next.text)
    // The cursor goes back where it was, past the field, once React has written the value.
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    const found = textProblems(draft)
    setProblems(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    setServerError(undefined)
    try {
      await client.mailTemplates.update(template.key, tidyText(draft))
      setDone(true)
      onSaved()
    } catch (err) {
      setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  // A part's error: what Save found, else a field the template does not have.
  const errorOf = (p: MailPart): string | undefined => {
    const problem = problems[p]
    if (problem) return t.mailTemplates.problems[problem]
    const unknown = unknownFields({ to: '', cc: '', subject: '', body: '', [p]: draft[p] }, template.fields)
    return unknown[0] !== undefined ? t.mailTemplates.unknownField(unknown[0]) : undefined
  }
  const focus = (p: MailPart) => () => setPart(p)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] lg:items-start">
      <form onSubmit={(e) => void save(e)} className="flex min-w-0 flex-col gap-4" noValidate>
        <Field label={t.mailTemplates.to} hint={t.mailTemplates.toHint} error={errorOf('to')}>
          {(p) => (
            <Input
              {...controlProps(p)}
              ref={inputs.to}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              maxLength={500}
              className="font-mono"
              value={draft.to}
              onFocus={focus('to')}
              onChange={(e) => type('to', e.target.value)}
            />
          )}
        </Field>
        <Field label={t.mailTemplates.cc} hint={t.mailTemplates.ccHint} error={errorOf('cc')}>
          {(p) => (
            <Input
              {...controlProps(p)}
              ref={inputs.cc}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              maxLength={500}
              className="font-mono"
              value={draft.cc}
              onFocus={focus('cc')}
              onChange={(e) => type('cc', e.target.value)}
            />
          )}
        </Field>
        <Field label={t.mailTemplates.subject} error={errorOf('subject')}>
          {(p) => (
            <Input
              {...controlProps(p)}
              ref={inputs.subject}
              autoComplete="off"
              maxLength={300}
              className="font-mono"
              value={draft.subject}
              onFocus={focus('subject')}
              onChange={(e) => type('subject', e.target.value)}
            />
          )}
        </Field>
        <Field label={t.mailTemplates.message} error={errorOf('body')}>
          {(p) => (
            <Textarea
              {...controlProps(p)}
              ref={inputs.body}
              rows={14}
              maxLength={10000}
              className="font-mono text-sm"
              value={draft.body}
              onFocus={focus('body')}
              onChange={(e) => type('body', e.target.value)}
            />
          )}
        </Field>
        <p role="status" className="text-sm">
          {done && !dirty ? t.mailTemplates.saved : dirty ? t.mailTemplates.unsaved : ''}
        </p>
        {serverError ? (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || !dirty}>
            {busy ? t.mailTemplates.saving : t.mailTemplates.save}
          </Button>
          {dirty ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => change(saved)}>
              {t.mailTemplates.discard}
            </Button>
          ) : null}
          {!isDefaultText ? (
            <Button type="button" variant="ghost" disabled={busy} title={t.mailTemplates.useDefaultHint} onClick={() => change(textOf(template.default))}>
              {t.mailTemplates.useDefault}
            </Button>
          ) : null}
        </div>
      </form>

      <div className="flex min-w-0 flex-col gap-6">
        <Card role="region" aria-labelledby={fieldsId}>
          <CardHeader>
            <CardTitle id={fieldsId}>{t.mailTemplates.fields}</CardTitle>
            <CardDescription>{t.mailTemplates.fieldsIntro}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1">
              {template.fields.map((f) => {
                const about = t.mailTemplates.fieldText[f.key] ?? f.label
                return (
                  <li key={f.key}>
                    <button
                      type="button"
                      aria-label={t.mailTemplates.insert(about)}
                      // Keeps the cursor in the part being typed in.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insert(f)}
                      className="grid min-h-11 w-full cursor-pointer gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="font-mono text-xs break-all">{`{{${f.key}}}`}</span>
                      <span className="text-xs text-muted-foreground">{about}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
        <PreviewCard preview={preview} />
      </div>
    </div>
  )
}

/** The draft as an email, with the fields' sample values. */
function PreviewCard({ preview }: { preview: { message?: MailMessage; error?: string; loading: boolean } }) {
  const titleId = useId()
  const m = preview.message
  return (
    <Card role="region" aria-labelledby={titleId} aria-busy={preview.loading || undefined}>
      <CardHeader>
        <CardTitle id={titleId}>{t.mailTemplates.preview}</CardTitle>
        <CardDescription>{t.mailTemplates.previewIntro}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {preview.error ? (
          <p role="alert" className="text-destructive">
            {preview.error}
          </p>
        ) : m ? (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">{t.mailTemplates.to}</dt>
              <dd className="break-all">{m.to}</dd>
              {m.cc ? (
                <>
                  <dt className="text-muted-foreground">{t.mailTemplates.cc}</dt>
                  <dd className="break-all">{m.cc}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">{t.mailTemplates.subject}</dt>
              <dd className="font-medium break-words">{m.subject}</dd>
            </dl>
            <p className="rounded-md bg-muted px-3 py-2 break-words whitespace-pre-wrap">{m.body}</p>
          </>
        ) : null}
        <p className="text-xs text-muted-foreground" aria-hidden={!preview.loading}>
          {preview.loading ? t.mailTemplates.previewing : ' '}
        </p>
      </CardContent>
    </Card>
  )
}
