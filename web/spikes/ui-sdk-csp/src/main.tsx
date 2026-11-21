import { ActionSheet, createActionSheet, Drawer } from '@ppe/ui/components/drawer'
import { Gallery } from '@ppe/ui/components/gallery'
import { ImageCropper } from '@ppe/ui/components/image-cropper'
import { toast, Toaster } from '@ppe/ui/components/toast'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'

const violations: string[] = []
document.addEventListener('securitypolicyviolation', (e) => violations.push(`${e.effectiveDirective}: ${e.blockedURI || 'inline'} ${e.sample}`))
;(window as unknown as { cspViolations: string[] }).cspViolations = violations

const sheet = createActionSheet<'download' | 'delete'>()
const picture = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#6b5a48"/><rect x="60" y="50" width="280" height="200" rx="12" fill="#e9f2ee"/></svg>')}`

function Spike() {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [answer, setAnswer] = useState('')
  const [seen, setSeen] = useState<string[]>([])
  useEffect(() => {
    const id = setInterval(() => setSeen([...violations]), 500)
    return () => clearInterval(id)
  }, [])
  const tag = document.querySelector('meta[property="csp-nonce"]') !== null
  return (
    <main className="flex flex-col gap-4 p-4">
      <h1 className="text-xl font-semibold">ui-sdk under style-src 'self' · {tag ? 'with' : 'without'} csp-nonce tag</h1>
      <p id="violations" data-count={seen.length} className={seen.length ? 'text-destructive' : 'text-emerald-700'}>
        {seen.length ? `${seen.length} CSP violations: ${seen.join(' | ')}` : 'No CSP violations'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-md border px-3 py-2" onClick={() => setOpen(true)}>Open Drawer</button>
        <button type="button" className="rounded-md border px-3 py-2" onClick={async () => setAnswer((await sheet.open()).returnValue ?? 'cancel')}>Open Action Sheet</button>
        <button type="button" className="rounded-md border px-3 py-2" onClick={() => toast.success('Saved', { description: 'ID card saved' })}>Show Toast</button>
      </div>
      <p id="answer">{answer}</p>
      <div className="h-64 rounded-lg border">
        <Gallery
          label="Document"
          page={page}
          onPageChange={setPage}
          className="h-full"
          items={['Back', 'Front'].map((l) => ({ id: l, label: l, page: <div className="flex h-40 w-64 items-center justify-center rounded bg-muted">{l}</div>, thumb: <span className="text-xs">{l}</span> }))}
        />
      </div>
      <div className="max-w-md">
        <ImageCropper label="Portrait" src={picture} alt="A specimen" aspectRatio={3 / 4} />
      </div>
      <Drawer open={open} onOpenChange={setOpen} title="ID card" description="Read today" snapPoints={[0.5, 1]} footer={<button type="button" className="rounded-md bg-primary px-3 py-2 text-primary-foreground" onClick={() => setOpen(false)}>Done</button>}>
        <p>Surname: Žukauskaitė</p>
      </Drawer>
      <ActionSheet sheet={sheet} title="Delete this scan?" actions={[{ value: 'download', label: 'Download Archive' }, { value: 'delete', label: 'Delete Scan', destructive: true }]} />
      <Toaster />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Spike />
  </StrictMode>,
)
