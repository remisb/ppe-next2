import { ApiError, type AskedField, type Employment, type GenerateInput, type GeneratableTemplate, type VaultDocument } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { DateInput } from '@ppe/ui/components/date-input'
import { Field, Input, Select, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { ActionError } from '@ppe/ui/components/states'
import { useAction } from '@ppe/ui/lib/use-action'
import { Eye, FileCog } from 'lucide-react'
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react'

import { type PdfFile, PdfPreview } from '@/components/pdf-preview'
import { t } from '@/i18n'
import { defaultEmployment, generateInput, inputProblems, pdfBlob, samePreview } from '@/lib/generate'
import { typeLabel } from '@/lib/vault'

/**
 * Generate Document… on an employee's page (ADR 0008 phase 3): a published
 * template, the employment it is for, the template's asked fields; Preview
 * draws it (PREVIEW in its footer), and Generate makes exactly what the
 * preview showed, numbered and kept as a locked PDF. Changing anything after
 * the preview asks for another.
 */
export function GenerateSheet({
  open,
  employeeId,
  employments,
  templates,
  onClose,
  onGenerated,
}: {
  open: boolean
  employeeId: string
  employments: readonly Employment[] | undefined
  templates: readonly GeneratableTemplate[]
  onClose: () => void
  onGenerated: (d: VaultDocument, message: string) => void
}) {
  const { client } = useApi()
  const formId = useId()
  const action = useAction()
  const [templateId, setTemplateId] = useState('')
  const [employmentId, setEmploymentId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [tried, setTried] = useState(false)
  const [preview, setPreview] = useState<{ input: GenerateInput; hash: string } | null>(null)
  const [pdf, setPdf] = useState<PdfFile | null>(null)

  useEffect(() => {
    if (!open) return
    setTemplateId(templates.length === 1 ? (templates[0]?.id ?? '') : '')
    setEmploymentId(defaultEmployment(employments))
    setAnswers({})
    setTried(false)
    setPreview(null)
    action.clear()
  }, [open])

  const tpl = templates.find((x) => x.id === templateId)
  const asked: AskedField[] = tpl?.asked ?? []
  const input = useMemo(() => generateInput(templateId, employeeId, employmentId, asked, answers), [templateId, employeeId, employmentId, asked, answers])
  const problems = tried ? inputProblems(asked, answers) : {}
  const previewed = preview !== null && samePreview(preview.input, input)

  const check = () => {
    setTried(true)
    return tpl !== undefined && Object.keys(inputProblems(asked, answers)).length === 0
  }
  const showPreview = () => {
    if (!check()) return
    void action.run(async () => {
      const got = await client.vault.generatePreview(input)
      setPreview({ input, hash: got.values_hash ?? '' })
      setPdf({ blob: pdfBlob(got.pdf), filename: `${tpl?.name ?? 'preview'}.pdf` })
    })
  }
  const generate = async (e: FormEvent) => {
    e.preventDefault()
    if (!check() || !preview || !previewed) return
    await action.run(
      async () => {
        const d = await client.vault.generate({ ...input, values_hash: preview.hash })
        onGenerated(d, t.vault.generated(d.number ?? ''))
      },
      { mapError: (err) => (err instanceof ApiError && err.status === 409 ? new Error(t.vault.stale) : err) },
    )
  }

  const answer = (a: AskedField) => (p: { id: string; describedBy: string | undefined; invalid: boolean }) => {
    const value = answers[a.key] ?? ''
    const set = (v: string) => setAnswers((cur) => ({ ...cur, [a.key]: v }))
    switch (a.kind) {
      case 'long_text':
        return <Textarea {...controlProps(p)} rows={3} value={value} onChange={(e) => set(e.target.value)} />
      case 'date':
        return <DateInput {...controlProps(p)} value={value} onChange={(v) => set(v)} />
      case 'choice':
        return (
          <Select {...controlProps(p)} value={value} onChange={(e) => set(e.target.value)}>
            <option value="" />
            {(a.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </Select>
        )
      case 'number':
      case 'money':
        return <Input {...controlProps(p)} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} />
      default:
        return <Input {...controlProps(p)} value={value} onChange={(e) => set(e.target.value)} />
    }
  }

  return (
    <>
      <FormSheet
        open={open}
        onClose={onClose}
        title={t.vault.generateTitle}
        info={t.vault.generateInfo}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button variant="outline" disabled={action.pending || !tpl} onClick={showPreview}>
              <Eye aria-hidden /> {action.pending && !previewed ? t.vault.previewing : t.vault.previewDocument}
            </Button>
            <Button type="submit" form={formId} disabled={action.pending || !previewed}>
              <FileCog aria-hidden /> {t.vault.generateButton}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={(e) => void generate(e)} className="grid gap-4" noValidate>
          <Field label={t.vault.template} required error={tried && !tpl ? t.vault.chooseTemplate : undefined}>
            {(p) => (
              <Select {...controlProps(p)} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">{t.vault.chooseTemplate}</option>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} · {typeLabel(x.type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {(employments?.length ?? 0) > 1 ? (
            <Field label={t.vault.employment}>
              {(p) => (
                <Select {...controlProps(p)} value={employmentId ?? ''} onChange={(e) => setEmploymentId(e.target.value || null)}>
                  {(employments ?? []).map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.company_name} · {j.started_on ?? '…'}–{j.ended_on ?? ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {asked.map((a) => (
            <Field key={a.key} label={a.label} required={a.required} error={problems[a.key]}>
              {answer(a)}
            </Field>
          ))}
          <p className="text-sm text-muted-foreground">{t.vault.previewFirst}</p>
        </form>
        <ActionError error={action.error} />
      </FormSheet>
      <PdfPreview file={pdf} label={t.vault.previewLabel} onClose={() => setPdf(null)} />
    </>
  )
}
