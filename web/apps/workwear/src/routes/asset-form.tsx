import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { ErrorState, Loading } from '@ppe/ui/components/states'
import { useLoad } from '@ppe/ui/lib/use-load'
import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { AssignmentFormDocument } from '@/components/assignment-form'
import { t } from '@/i18n'
import type { FormDraft } from '@/lib/router'

/**
 * An assignment form on its own page, for printing (§8): a stored one, as it
 * was given, or the one Give SIM would store, built by the API from the
 * draft. Printing is not giving. With autoPrint the print dialog opens once it
 * has loaded, as Print Record does.
 */
export function AssetFormPage({
  id,
  assignment,
  draft,
  autoPrint,
  onBack,
}: {
  id: string
  assignment: string | undefined
  draft: FormDraft | undefined
  autoPrint: boolean
  onBack: () => void
}) {
  const { client } = useApi()
  const form = useLoad(
    () =>
      assignment
        ? client.assets.form(id, assignment)
        : draft
          ? client.assets.previewForm(id, {
              employee_id: draft.employeeId,
              given_date: draft.givenDate,
              ...(draft.plan ? { plan: draft.plan } : {}),
              ...(draft.valueCents !== undefined ? { non_return_value_cents: draft.valueCents } : {}),
            })
          : Promise.reject(new Error(t.assets.formChangedError)),
    [id, assignment, JSON.stringify(draft)],
  )
  const printed = useRef(false)

  // Each print is recorded as the user's activity (asset.form_printed) before
  // the dialog opens: this tab does it, so it is not lost when the page that
  // opened the tab is in the background. Printing goes ahead if it fails.
  const print = async () => {
    const record = assignment
      ? client.assets.recordFormReprinted(id, assignment)
      : draft
        ? client.assets.recordFormPrinted(id, {
            employee_id: draft.employeeId,
            given_date: draft.givenDate,
            ...(draft.plan ? { plan: draft.plan } : {}),
            ...(draft.valueCents !== undefined ? { non_return_value_cents: draft.valueCents } : {}),
          })
        : Promise.resolve()
    await record.catch(() => {})
    window.print()
  }

  useEffect(() => {
    if (autoPrint && form.data && !printed.current) {
      printed.current = true
      void print()
    }
  }, [autoPrint, form.data])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2 print:hidden">
        <Button variant="ghost" className="-ml-3" onClick={onBack}>
          <ArrowLeft aria-hidden /> {t.common.back}
        </Button>
        {form.data ? (
          <Button onClick={() => void print()}>
            <Printer aria-hidden /> {t.assets.printForm}
          </Button>
        ) : null}
      </div>
      {form.error ? (
        <ErrorState error={form.error} onRetry={form.reload} />
      ) : !form.data ? (
        <Loading />
      ) : (
        <>
          {assignment ? null : <p className="mb-3 text-sm text-muted-foreground print:hidden">{t.assets.formLayoutNote}</p>}
          <AssignmentFormDocument form={form.data.form} documentHash={form.data.document_hash} />
        </>
      )}
    </>
  )
}
