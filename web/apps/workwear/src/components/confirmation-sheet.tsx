import type { ConfirmationLink, ListedOrder } from '@ppe/api-client'
import { Copy, ExternalLink } from 'lucide-react'
import { useEffect, useState } from 'react'

import { ErrorState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { WhatsAppButton } from '@/components/whatsapp-button'
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
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setLink(null)
    setError(undefined)
    setCopied(false)
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
      title="Open Employee Confirmation"
      description={`${order.record_number} · ${name}. The employee confirms receipt on a secure page, or signs the printed record.`}
    >
      <div className="flex flex-col gap-6">
        {error ? <ErrorState title="That did not work" error={error} /> : null}

        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Electronic confirmation</h3>
          {link ? (
            <>
              <div className="flex gap-2">
                <Input readOnly aria-label="Confirmation link" value={link.url} onFocus={(e) => e.target.select()} />
                <Button
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard.writeText(link.url).then(
                      () => setCopied(true),
                      () => setCopied(false),
                    )
                  }
                >
                  <Copy aria-hidden /> {copied ? 'Copied' : 'Copy link'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Valid until {formatDateTime(link.expires_at, undefined)}. This link is shown once; creating another replaces it.
              </p>
              <div className="flex flex-wrap items-start gap-2">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm hover:bg-accent"
                >
                  <ExternalLink aria-hidden className="size-4" /> Open on this device
                </a>
                <WhatsAppButton
                  label="Share link via WhatsApp"
                  text={`${name}, please confirm receipt of your workwear (${order.record_number}):\n${link.url}`}
                />
              </div>
            </>
          ) : (
            <Button className="w-fit" disabled={busy} onClick={() => void run(async () => setLink(await client.orders.createConfirmationLink(order.id)))}>
              Create confirmation link
            </Button>
          )}
        </section>

        <section className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="font-medium">Paper confirmation</h3>
          <p className="text-sm text-muted-foreground">
            Print the record, have the employee sign it, then record that the signed copy was received.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onPrint(order.id)}>
              Print Record
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Record that ${name} signed the paper record for ${order.record_number}? The order becomes Given.`)) return
                void run(async () => {
                  await client.orders.confirmPaper(order.id)
                  onGiven()
                })
              }}
            >
              Record signed paper confirmation
            </Button>
          </div>
        </section>
      </div>
    </FormSheet>
  )
}
