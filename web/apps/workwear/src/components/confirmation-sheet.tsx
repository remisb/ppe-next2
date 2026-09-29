import type { ConfirmationLink, ListedOrder } from '@ppe/api-client'
import { Copy, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ErrorState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { WhatsAppButton } from '@/components/whatsapp-button'
import { t } from '@/i18n'
import { useApi } from '@/lib/api'
import { formatDateTime } from '@/lib/history'

/**
 * Open Employee Confirmation for an ORDERED order: create a secure link for
 * the employee (electronic), or print the record and record a signed paper
 * confirmation. A new link replaces any earlier unused one.
 */
export function ConfirmationSheet({
  order,
  onClose,
  onGiven,
  onPrint,
}: {
  order: ListedOrder | null
  onClose: () => void
  onGiven: () => void
  onPrint: (orderId: string) => void
}) {
  const { client } = useApi()
  const [link, setLink] = useState<ConfirmationLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>()

  useEffect(() => {
    setLink(null)
    setError(undefined)
  }, [order])

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await f()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  if (!order) return <FormSheet open={false} onClose={onClose} title="" children={null} />
  const name = `${order.employee_first_name} ${order.employee_last_name}`

  return (
    <FormSheet
      open
      onClose={onClose}
      title={t.history.openConfirmation}
      description={t.history.confirmationDescription(order.record_number, name)}
    >
      <div className="flex flex-col gap-6">
        {error ? <ErrorState title={t.history.didNotWork} error={error} /> : null}

        <section className="flex flex-col gap-2">
          <h3 className="font-medium">{t.history.electronicConfirmation}</h3>
          {link ? (
            <ConfirmationLinkView link={link} name={name} recordNumber={order.record_number} />
          ) : (
            <Button className="w-full sm:w-fit" disabled={busy} onClick={() => void run(async () => setLink(await client.orders.createConfirmationLink(order.id)))}>
              {t.history.createLink}
            </Button>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="font-medium">{t.history.paperConfirmation}</h3>
          <p className="text-sm text-muted-foreground">{t.history.paperSteps}</p>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <Button variant="outline" onClick={() => onPrint(order.id)}>
              {t.history.printRecord}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(t.history.recordPaperQuestion(name, order.record_number))) return
                void run(async () => {
                  await client.orders.confirmPaper(order.id)
                  onGiven()
                })
              }}
            >
              {t.history.recordPaper}
            </Button>
          </div>
        </section>
      </div>
    </FormSheet>
  )
}

/**
 * A confirmation link just created: shown once, with Copy, Open on this device
 * and Share via WhatsApp. Also on the success screen after Mark as Ordered
 * when the review created the link as well.
 */
export function ConfirmationLinkView({ link, name, recordNumber }: { link: ConfirmationLink; name: string; recordNumber: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <div className="flex gap-2">
        <Input readOnly aria-label={t.history.confirmationLink} className="min-w-0 flex-1" value={link.url} onFocus={(e) => e.target.select()} />
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() =>
            void navigator.clipboard.writeText(link.url).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          <Copy aria-hidden /> {copied ? t.history.copied : t.history.copyLink}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t.history.linkValidUntil(formatDateTime(link.expires_at, undefined))}
      </p>
      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-start">
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          <ExternalLink aria-hidden className="size-4" /> {t.history.openOnThisDevice}
        </a>
        <WhatsAppButton
          className="sm:w-auto"
          label={t.history.shareLinkWhatsApp}
          text={t.history.linkMessage(name, recordNumber, link.url)}
        />
      </div>
    </>
  )
}
