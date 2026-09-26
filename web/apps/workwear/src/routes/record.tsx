import { ArrowLeft, Printer } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { ReceiptDocument } from '@/components/receipt'
import { ErrorState, Loading } from '@/components/states'
import { Button } from '@/components/ui/button'
import { WhatsAppButton } from '@/components/whatsapp-button'
import { useApi } from '@/lib/api'
import { useLoad } from '@/lib/use-load'
import { formatWhatsApp, recordMessage } from '@/lib/whatsapp'

/**
 * View Record / Print Record. With autoPrint the browser's print dialog opens
 * once the record has loaded.
 */
export function RecordPage({ id, autoPrint, onBack }: { id: string; autoPrint: boolean; onBack: () => void }) {
  const { client } = useApi()
  const record = useLoad(() => client.orders.record(id), [id])
  const settings = useLoad(() => client.settings())
  const printed = useRef(false)

  useEffect(() => {
    if (autoPrint && record.data && settings.data && !printed.current) {
      printed.current = true
      window.print()
    }
  }, [autoPrint, record.data, settings.data])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2 print:hidden">
        <Button variant="ghost" className="-ml-3" onClick={onBack}>
          <ArrowLeft aria-hidden /> Back
        </Button>
        {record.data ? (
          <div className="flex flex-wrap items-start gap-2">
            {record.data.status === 'GIVEN' ? (
              <WhatsAppButton label="Share via WhatsApp" text={formatWhatsApp(recordMessage(record.data))} />
            ) : null}
            <Button onClick={() => window.print()}>
              <Printer aria-hidden /> Print Record
            </Button>
          </div>
        ) : null}
      </div>
      {record.error ? (
        <ErrorState error={record.error} onRetry={record.reload} />
      ) : !record.data ? (
        <Loading />
      ) : (
        <ReceiptDocument record={record.data} timeZone={settings.data?.timezone} />
      )}
    </>
  )
}
