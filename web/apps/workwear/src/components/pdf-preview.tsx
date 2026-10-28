import { Button, buttonVariants } from '@ppe/ui/components/button'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { saveFile } from '@ppe/ui/lib/save-file'
import { cn } from '@ppe/ui/lib/utils'
import { Download, ExternalLink, Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { t } from '@/i18n'

/** A PDF the API sent, and the name it gave it. */
export interface PdfFile {
  blob: Blob
  filename: string
}

/**
 * Shows a PDF the API drew before it is printed: in the browser's own PDF
 * viewer, in a wide form sheet, every page, with Print, Download PDF and Open
 * in New Tab. The file is the one already fetched, so each of them sends the
 * same pages; it lives as a blob: URL while the sheet is open (the CSP's
 * frame-src allows it). A browser that cannot show PDFs inline (Android's)
 * says so and offers the tab and the download instead.
 */
export function PdfPreview({ file, label, onClose }: { file: PdfFile | null; label: string; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!file) return
    const u = URL.createObjectURL(new Blob([file.blob], { type: 'application/pdf' }))
    setUrl(u)
    return () => {
      URL.revokeObjectURL(u)
      setUrl(null)
    }
  }, [file])
  // Every current browser says whether it shows PDFs inline; an older one is given the chance.
  const inline = navigator.pdfViewerEnabled !== false

  // The viewer prints the PDF itself; where it cannot be reached, the PDF opens in a tab to print from there.
  const print = () => {
    const viewer = frame.current?.contentWindow
    if (viewer) {
      try {
        viewer.focus()
        viewer.print()
        return
      } catch {
        // Falls through to the tab.
      }
    }
    if (url) window.open(url, '_blank', 'noopener')
  }

  return (
    <FormSheet
      open={file !== null}
      onClose={onClose}
      title={t.assets.pdfPreview}
      {...(file ? { description: file.filename } : {})}
      wide={inline}
      footer={
        file && url ? (
          <>
            <a href={url} target="_blank" rel="noopener" className={cn(buttonVariants({ variant: 'outline' }))}>
              <ExternalLink aria-hidden /> {t.assets.openInNewTab}
            </a>
            <Button variant="outline" onClick={() => saveFile(file.blob, file.filename)}>
              <Download aria-hidden /> {t.assets.downloadPdf}
            </Button>
            {inline ? (
              <Button onClick={print}>
                <Printer aria-hidden /> {t.assets.print}
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {url && inline ? (
        <iframe ref={frame} src={url} title={label} className="h-full min-h-96 w-full rounded-md border border-border bg-muted" />
      ) : url ? (
        <p className="text-sm text-muted-foreground">{t.assets.noInlinePdf}</p>
      ) : null}
    </FormSheet>
  )
}
