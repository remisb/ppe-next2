import type { VaultDocument, VaultType, VaultVersion } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { formatBytes } from '@ppe/backups'
import { Badge } from '@ppe/ui/components/badge'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { linkVariants } from '@ppe/ui/components/link'
import { PaneBar } from '@ppe/ui/components/list-detail'
import { RecordHeader, RecordTitle, type RecordNav } from '@ppe/ui/components/record-header'
import { ActionError, Loaded } from '@ppe/ui/components/states'
import { formatDate, formatDay } from '@ppe/ui/lib/dates'
import { saveFile } from '@ppe/ui/lib/save-file'
import { useAction } from '@ppe/ui/lib/use-action'
import { useLoad } from '@ppe/ui/lib/use-load'
import { FileDown, Lock, ShieldAlert } from 'lucide-react'
import { InfoTip } from '@ppe/ui/components/info-tip'
import { useMemo, useState } from 'react'

import { AddVersionSheet, DocumentDetailsSheet, HoldSheet } from '@/components/document-sheets'
import { t } from '@/i18n'
import { todayIn } from '@/lib/assets'
import { documentActions } from '@/lib/document-actions'
import { useOpenKey } from '@/lib/open-sections'
import { type Route, linkTo } from '@/lib/router'
import { displayTitle, expiry, linkRoute, typeLabel } from '@/lib/vault'

const link = linkVariants({ weight: 'medium', className: 'inline-flex min-h-11 items-center gap-1 md:min-h-0' })

/**
 * One document beside Document Vault's list (or on its own on a narrow
 * screen): its title and type, Download and, for whoever may change it,
 * Edit…, Add Version… and Remove document…; its dates, what it is linked to,
 * its versions, each to download, and its Changes.
 */
export function DocumentDetail({
  id,
  types,
  timeZone,
  navigate,
  onClose,
  onChanged,
  onRemoved,
}: {
  id: string
  types: readonly VaultType[] | undefined
  timeZone: string | undefined
  navigate: (to: Route) => void
  onClose: () => void
  onChanged: () => void
  onRemoved: (message: string) => void
}) {
  const { client } = useApi()
  const doc = useLoad(() => client.vault.get(id), [id])
  return (
    <article aria-label={doc.data ? t.vault.documentLabel(displayTitle(doc.data)) : t.vault.document} className="@container flex flex-col gap-4">
      <PaneBar backLabel={t.vault.title} closeLabel={t.vault.closeDocument} onClose={onClose} className="self-start" />
      <Loaded load={doc}>
        {(d) => (
          <DocumentBody
            key={d.id}
            document={d}
            types={types}
            timeZone={timeZone}
            navigate={navigate}
            nav={{ backLabel: t.vault.title, onBack: onClose, closeLabel: t.vault.closeDocument }}
            onChanged={() => {
              doc.reload()
              onChanged()
            }}
            onRemoved={onRemoved}
          />
        )}
      </Loaded>
    </article>
  )
}

function DocumentBody({
  document: d,
  types,
  timeZone,
  navigate,
  nav,
  onChanged,
  onRemoved,
}: {
  document: VaultDocument
  types: readonly VaultType[] | undefined
  timeZone: string | undefined
  navigate: (to: Route) => void
  nav: RecordNav
  onChanged: () => void
  onRemoved: (message: string) => void
}) {
  const { client } = useApi()
  const session = useSession()
  const action = useAction()
  const [downloading, setDownloading] = useState(false)
  const [sheet, setSheet] = useState<'edit' | 'version' | 'hold' | null>(null)
  const [message, setMessage] = useState('')
  const type = types?.find((ty) => ty.key === d.type)
  const current = d.versions[0]
  const ends = expiry(d.valid_until, todayIn(timeZone))
  const changesKey = useOpenKey('vault.changes')

  const download = async (v: VaultVersion | undefined) => {
    if (!v) return
    setDownloading(true)
    await action.run(async () => {
      // A sealed document's file asks Confirm your password when the sign-in is not recent, and is recorded.
      const f = d.sealed ? await client.vault.openSealed(d.id, v.number) : await client.vault.file(d.id, v.number)
      saveFile(f.blob, v.file.file_name || f.filename)
    })
    setDownloading(false)
  }
  const remove = () =>
    void action.run(
      async () => {
        await client.vault.remove(d.id)
        onRemoved(t.vault.removed(displayTitle(d)))
      },
      { confirm: t.vault.removeQuestion(displayTitle(d)) },
    )
  const actions = documentActions(
    { manage: session.can((type?.manage ?? 'vault.manage') as never), locked: d.locked, downloading, hold: d.sealed },
    { download: () => void download(current), edit: () => setSheet('edit'), addVersion: () => setSheet('version'), remove, hold: () => setSheet('hold') },
  )
  // One object per opening, so the sheet starts afresh only when opened.
  const editSheet = useMemo(() => (sheet === 'edit' ? ({ kind: 'edit', document: d } as const) : null), [sheet, d])
  const saved = (_: VaultDocument, m: string) => {
    setSheet(null)
    setMessage(m)
    onChanged()
  }

  return (
    <>
      <RecordHeader className="mb-0" nav={nav} title={<RecordTitle>{displayTitle(d)}</RecordTitle>} actions={actions} moreLabel={t.vault.moreActions(displayTitle(d))}>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{typeLabel(d.type)}</Badge>
          {d.sealed ? (
            <span className="inline-flex items-center gap-1">
              <Badge variant="outline">
                <Lock aria-hidden className="size-3" /> {t.vault.sealed}
              </Badge>
              <InfoTip section={t.vault.sealed}>{t.vault.sealedInfo}</InfoTip>
            </span>
          ) : null}
          {ends === 'expired' ? <Badge variant="destructive">{t.vault.expired}</Badge> : null}
          {ends === 'soon' ? <Badge variant="outline">{t.vault.expiresSoon}</Badge> : null}
        </div>
      </RecordHeader>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {message}
      </p>
      <ActionError error={action.error} />
      {d.hold_until ? (
        <p className="flex items-start gap-2 text-sm">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
          {t.vault.held(formatDay(d.hold_until), d.hold_reason ?? '')}
        </p>
      ) : null}

      <FactGrid>
        {d.number ? <Fact label={t.vault.number}>{d.number}</Fact> : null}
        {d.document_date ? <Fact label={t.vault.documentDate}>{formatDay(d.document_date)}</Fact> : null}
        {d.valid_from ? <Fact label={t.vault.validFrom}>{formatDay(d.valid_from)}</Fact> : null}
        {d.valid_until ? <Fact label={t.vault.validUntil}>{formatDay(d.valid_until)}</Fact> : null}
        <Fact label={t.vault.origin}>{t.vault.origins[d.origin]}</Fact>
        {d.retain_until ? (
          <Fact label={t.vault.keptUntil}>
            <span className="inline-flex items-center gap-1">
              {formatDay(d.retain_until)}
              <InfoTip section={t.vault.keptUntil}>{t.vault.keptUntilHint}</InfoTip>
            </span>
          </Fact>
        ) : null}
        <Fact label={t.vault.linkedTo} wide>
          {d.links.length === 0 ? (
            <span className="text-muted-foreground">{t.vault.notLinked}</span>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {d.links.map((l) => {
                const to = linkRoute(l, d.title)
                return (
                  <li key={`${l.kind}:${l.id}`}>
                    <span className="text-muted-foreground">{t.vault.kinds[l.kind]}: </span>
                    {to ? (
                      <a {...linkTo(to, navigate)} className={linkVariants()}>
                        {l.label}
                      </a>
                    ) : (
                      l.label
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Fact>
      </FactGrid>

      <DisclosureSection id={`versions-${d.id}`} title={t.vault.versions} count={d.versions.length} defaultOpen>
        <ul className="flex flex-col gap-3">
          {d.versions.map((v) => (
            <li key={v.id} className="grid gap-0.5">
              <span className="text-sm font-medium">{t.vault.versionLine(v.number, t.vault.versionOrigins[v.origin])}</span>
              <button type="button" className={`${link} cursor-pointer justify-self-start`} aria-label={t.vault.downloadFile(v.file.file_name)} onClick={() => void download(v)}>
                <FileDown aria-hidden className="size-3.5" /> {v.file.file_name}
              </button>
              <span className="text-xs text-muted-foreground">
                {t.vault.fileDetails(formatBytes(v.file.size_bytes), formatDate(v.created_at, timeZone), v.created_by_name)}
              </span>
              {v.note ? <span className="text-sm whitespace-pre-line">{v.note}</span> : null}
              <span className="font-mono text-xs break-all text-muted-foreground" title={t.vault.sha256}>
                {v.file.sha256}
              </span>
            </li>
          ))}
        </ul>
      </DisclosureSection>

      <RecordChanges load={() => client.audit.history('vault', d.id)} deps={[d.id, d.updated_at]} timeZone={timeZone} rememberAs={changesKey} className="mb-0" />

      <DocumentDetailsSheet sheet={editSheet} types={types} onClose={() => setSheet(null)} onSaved={saved} />
      <AddVersionSheet document={sheet === 'version' ? d : null} types={types} onClose={() => setSheet(null)} onSaved={saved} />
      <HoldSheet document={sheet === 'hold' ? d : null} onClose={() => setSheet(null)} onSaved={saved} />
    </>
  )
}
