import { ApiError, type AssetAssignment, type SignedCopy } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { formatBytes } from '@ppe/backups'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { formatDateTime } from '@ppe/ui/lib/dates'
import { saveFile } from '@ppe/ui/lib/save-file'
import { errorText } from '@ppe/ui/lib/use-load'
import { FileDown, Upload } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { t } from '@/i18n'
import { SIGNED_COPY_ACCEPT, formatDay, signedCopyProblem, uploadRefusal } from '@/lib/assets'

const link = 'inline-flex min-h-11 items-center gap-1 rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring md:min-h-0'

/**
 * An assignment's signed copies (§9): Signed Copy Uploaded with the newest to
 * download, or Signed Copy Missing; Upload Signed Form for those who manage
 * assets, any time after giving; the earlier copies folded away.
 */
export function SignedCopies({
  assetId,
  inventoryNo,
  assignment,
  canManage,
  timeZone,
  onUploaded,
}: {
  assetId: string
  inventoryNo: string
  assignment: AssetAssignment
  canManage: boolean
  timeZone: string | undefined
  onUploaded: (message: string) => void
}) {
  const { client } = useApi()
  const input = useRef<HTMLInputElement>(null)
  const hint = useId()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [latest, ...earlier] = assignment.signed_copies ?? []

  const upload = async (file: File) => {
    const why = signedCopyProblem(file)
    setProblem(why ?? undefined)
    if (why) return
    setBusy(true)
    try {
      await client.assets.uploadSignedCopy(assetId, assignment.id, file)
      onUploaded(t.assets.signedCopyAdded(inventoryNo))
    } catch (err) {
      setProblem((err instanceof ApiError ? uploadRefusal(err.status) : null) ?? errorText(err))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const download = async (c: SignedCopy) => {
    setProblem(undefined)
    try {
      const file = await client.assets.signedCopy(assetId, assignment.id, c.id)
      saveFile(file.blob, c.file_name)
    } catch (err) {
      setProblem(errorText(err))
    }
  }

  const copy = (c: SignedCopy) => (
    <span className="flex flex-wrap items-center gap-x-2">
      <button type="button" className={`${link} cursor-pointer`} aria-label={t.assets.downloadCopy(c.file_name)} onClick={() => void download(c)}>
        <FileDown aria-hidden className="size-3.5" /> {c.file_name}
      </button>
      <span className="text-xs text-muted-foreground">
        {t.assets.copyDetails(formatBytes(c.size_bytes), formatDay(formatDateTime(c.uploaded_at, timeZone).slice(0, 10)), c.uploaded_by_name)}
      </span>
    </span>
  )

  return (
    <div className="mt-2 grid gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {latest ? <Badge variant="secondary">{t.assets.signedCopyUploaded}</Badge> : <Badge variant="outline">{t.assets.signedCopyMissing}</Badge>}
        {latest ? copy(latest) : null}
        {canManage ? (
          <>
            <input
              ref={input}
              type="file"
              accept={SIGNED_COPY_ACCEPT}
              className="hidden"
              aria-label={t.assets.uploadSignedForm}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
              }}
            />
            <Button variant="outline" size="sm" disabled={busy} aria-describedby={hint} onClick={() => input.current?.click()}>
              <Upload aria-hidden /> {busy ? t.assets.uploading : t.assets.uploadSignedForm}
            </Button>
          </>
        ) : null}
      </div>
      {canManage ? (
        <p id={hint} className="text-xs text-muted-foreground">
          {t.assets.uploadHint}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      {earlier.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground pointer-coarse:py-3">{t.assets.earlierCopies(earlier.length)}</summary>
          <ul className="mt-1 grid gap-1">
            {earlier.map((c) => (
              <li key={c.id}>{copy(c)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}
