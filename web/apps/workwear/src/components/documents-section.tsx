import type { VaultSubjectKind } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { linkVariants } from '@ppe/ui/components/link'
import { Loaded } from '@ppe/ui/components/states'
import { formatDay } from '@ppe/ui/lib/dates'
import { useRememberedOpen } from '@ppe/ui/lib/remembered-open'
import { useLoad } from '@ppe/ui/lib/use-load'
import { Upload } from 'lucide-react'
import { useMemo, useState } from 'react'

import { DocumentDetailsSheet, type DocumentSheet } from '@/components/document-sheets'
import { t } from '@/i18n'
import { todayIn } from '@/lib/assets'
import { useOpenKey } from '@/lib/open-sections'
import { type Route, linkTo } from '@/lib/router'
import { displayTitle, expiry, seesVault, typeLabel, uploadTypes } from '@/lib/vault'

/**
 * Documents on an employee's page or an asset (ADR 0008): the Document Vault's
 * documents linked to it, each opening in the vault, and Upload Document…
 * with the link made, for whoever may add documents. Shown with See
 * documents (vault.read) alone.
 */
export function DocumentsSection({
  kind,
  id,
  label,
  timeZone,
  navigate,
}: {
  kind: VaultSubjectKind
  id: string
  /** The subject's name, for the link Upload Document… makes. */
  label: string
  timeZone: string | undefined
  navigate: (to: Route) => void
}) {
  const { client } = useApi()
  const session = useSession()
  const can = seesVault((p) => session.can(p))
  const docs = useLoad(() => (can ? client.vault.bySubject(kind, id) : Promise.resolve([])), [kind, id, can])
  const types = useLoad(() => (can ? client.vault.types() : Promise.resolve([])), [can])
  const [sheet, setSheet] = useState<DocumentSheet | null>(null)
  const [message, setMessage] = useState('')
  // Kept as it was left; opened once a document is uploaded here, so it shows.
  const [open, setOpen] = useRememberedOpen(useOpenKey(`${kind}.documents`), false)
  const upload = useMemo(
    (): DocumentSheet => ({ kind: 'upload', links: [{ kind, id, label, fixed: true }], ...(kind === 'asset' ? { type: 'asset.document' } : {}) }),
    [kind, id, label],
  )
  if (!can) return null
  const canUpload = uploadTypes(types.data ?? [], (p) => session.can(p as never), [kind]).length > 0
  const today = todayIn(timeZone)

  return (
    <>
    <DisclosureSection
      id={`documents-${kind}`}
      title={t.vault.section}
      count={docs.data?.length}
      description={t.vault.sectionHint}
      open={open}
      onOpenChange={setOpen}
      action={
        canUpload ? (
          <Button variant="outline" size="sm" onClick={() => setSheet(upload)}>
            <Upload aria-hidden className="size-4" />
            {t.vault.upload}
          </Button>
        ) : undefined
      }
    >
      <p role="status" className="mb-2 text-sm text-muted-foreground empty:hidden">
        {message}
      </p>
      <Loaded load={docs} emptyState={t.vault.sectionNone}>
        {(list) => (
          <ul className="flex flex-col gap-2">
            {list.map((d) => {
              const ends = expiry(d.valid_until, today)
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <a {...linkTo({ name: 'vault', document: d.id }, navigate)} className={linkVariants({ weight: 'medium' })}>
                    {displayTitle(d)}
                  </a>
                  {d.sealed ? <Badge variant="outline">{t.vault.sealed}</Badge> : null}
                  <span className="text-xs text-muted-foreground">
                    {typeLabel(d.type)}
                    {d.valid_until ? ` · ${t.vault.validUntil} ${formatDay(d.valid_until)}` : ''}
                  </span>
                  {ends === 'expired' ? <Badge variant="destructive">{t.vault.expired}</Badge> : null}
                  {ends === 'soon' ? <Badge variant="outline">{t.vault.expiresSoon}</Badge> : null}
                </li>
              )
            })}
          </ul>
        )}
      </Loaded>
    </DisclosureSection>
    {/* Outside the section, so Upload Document… opens it while the section is closed. */}
    <DocumentDetailsSheet
        sheet={sheet?.kind === 'upload' ? sheet : null}
        types={types.data}
        onClose={() => setSheet(null)}
        onSaved={(_, m) => {
          setSheet(null)
          setMessage(m)
          setOpen(true)
          docs.reload()
        }}
      />
    </>
  )
}
