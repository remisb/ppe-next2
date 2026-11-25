import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { ActionError, Loaded } from '@ppe/ui/components/states'
import { saveFile } from '@ppe/ui/lib/save-file'
import { useAction } from '@ppe/ui/lib/use-action'
import { useLoad } from '@ppe/ui/lib/use-load'
import { BackButton } from '@ppe/ui/components/back-button'
import { FileDown, Printer } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { ReceiptDocument } from '@/components/receipt'
import { WhatsAppButton } from '@/components/whatsapp-button'
import { t } from '@/i18n'
import { formatWhatsApp, recordMessage } from '@/lib/whatsapp'

/**
 * View Record / Print Record, and Download PDF (the API's PDF of the record, as
 * the Document Vault keeps it once given). With autoPrint the browser's print
 * dialog opens once the record has loaded.
 */
export function RecordPage({ id, autoPrint, onBack }: { id: string; autoPrint: boolean; onBack: () => void }) {
  const { client } = useApi()
  const record = useLoad(() => client.orders.record(id), [id])
  const settings = useLoad(() => client.settings())
  const printed = useRef(false)
  const action = useAction()
  const download = () =>
    void action.run(async () => {
      const { blob, filename } = await client.orders.recordPDF(id)
      saveFile(blob, filename)
    })

  useEffect(() => {
    if (autoPrint && record.data && settings.data && !printed.current) {
      printed.current = true
      window.print()
    }
  }, [autoPrint, record.data, settings.data])

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2 print:hidden">
        <BackButton onClick={onBack}>{t.common.back}</BackButton>
        {record.data ? (
          <div className="flex flex-wrap items-start gap-2">
            {record.data.status === 'GIVEN' ? (
              <WhatsAppButton label={t.history.shareWhatsApp} text={formatWhatsApp(recordMessage(record.data))} />
            ) : null}
            <Button variant="outline" disabled={action.pending} onClick={download}>
              <FileDown aria-hidden /> {t.history.downloadRecordPdf}
            </Button>
            <Button onClick={() => window.print()}>
              <Printer aria-hidden /> {t.history.printRecord}
            </Button>
          </div>
        ) : null}
      </div>
      <ActionError error={action.error} className="print:hidden" />
      <Loaded load={record}>
        {(data) => (
          <ReceiptDocument record={data} timeZone={settings.data?.timezone} />
        )}
      </Loaded>
    </>
  )
}
