import type { VaultHit, VaultIdentityRow, VaultQuery } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { EXPORT_MODE, ExportMode } from '@ppe/ui/components/export-mode'
import { InfoTip } from '@ppe/ui/components/info-tip'
import { Field, Input, Select, controlProps } from '@ppe/ui/components/field'
import { DetailPane, ListDetail } from '@ppe/ui/components/list-detail'
import { linkVariants } from '@ppe/ui/components/link'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { RowCheckbox, SelectAllCheckbox, selectCellClass, selectRowClass } from '@ppe/ui/components/selection-bar'
import { EmptyState, ErrorState, ListSkeleton, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, stackedBreak } from '@ppe/ui/components/table'
import { formatDay } from '@ppe/ui/lib/dates'
import { besideList, useListKeys } from '@ppe/ui/lib/list-keys'
import { useLoad } from '@ppe/ui/lib/use-load'
import { selectRowProps, useSelection } from '@ppe/ui/lib/use-selection'
import { cn } from '@ppe/ui/lib/utils'
import { ChevronRight, Download, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { DocumentDetail } from '@/components/document-detail'
import { DocumentDetailsSheet, type DocumentSheet } from '@/components/document-sheets'
import { t } from '@/i18n'
import { todayIn } from '@/lib/assets'
import { type NavigateOptions, type Route, linkTo } from '@/lib/router'
import { displayTitle, expiry, identityLines, linkLabels, typeLabel, uploadTypes } from '@/lib/vault'
import { vaultExportColumns } from '@/lib/vault-export'

/** A document's key in the selection; a module constant, so the hook's memos hold. */
const documentId = (d: VaultHit) => d.id

/** An upload from the screen itself: no link given, the employee chosen in the sheet. */
const fromScreen: Extract<DocumentSheet, { kind: 'upload' }> = { kind: 'upload', links: [] }

/**
 * Document Vault (ADR 0008, docs/specs/vault-service.md): every document the
 * reader may see, newest first, or the ones matching the search (titles,
 * numbers, linked names, accents folded, words as prefixes), filtered by
 * type. A row opens its document (/vault/<id>): beside the list on a wide
 * screen, on its own on a narrow one, as Orders opens an order.
 */
export function Vault({ selected, navigate }: { selected: string | undefined; navigate: (to: Route, options?: NavigateOptions) => void }) {
  const { client } = useApi()
  const session = useSession()
  const settings = useLoad(() => client.settings())
  const tz = settings.data?.timezone
  const types = useLoad(() => client.vault.types())
  const [words, setWords] = useState('')
  const [typed, setTyped] = useState('')
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')

  // The words as typed, searched a moment after typing stops, so each key does not ask the server.
  useEffect(() => {
    const later = setTimeout(() => {
      if (typed !== words) {
        setWords(typed)
        setPage(1)
      }
    }, 300)
    return () => clearTimeout(later)
  }, [typed])

  const query: VaultQuery = { query: words, ...(type ? { types: [type] } : {}), page }
  const key = JSON.stringify(query)
  const docs = useLoad(() => client.vault.search(query), [key])

  const open = (id: string) => navigate({ name: 'vault', document: id }, { scroll: !besideList() })
  const close = () => navigate({ name: 'vault' }, { scroll: false })
  const shownIds = useMemo(() => docs.data?.documents.map((d) => d.id), [docs.data])
  useListKeys({ ids: shownIds, selected, onOpen: (id) => navigate({ name: 'vault', document: id }, { scroll: false }), onClose: close })
  const selection = useSelection(useMemo(() => docs.data?.documents ?? [], [docs.data]), documentId)

  const canUpload = uploadTypes(types.data ?? [], (p) => session.can(p as never), []).length > 0
  const filtered = words.trim() !== '' || type !== ''
  const pages = docs.data ? Math.max(1, Math.ceil(docs.data.total / docs.data.page_size)) : 1
  const today = todayIn(tz)
  const beside = selected !== undefined
  const clear = () => {
    setTyped('')
    setWords('')
    setType('')
    setPage(1)
  }

  return (
    <ListDetail
      width="md"
      pane={
        selected ? (
          <DetailPane label={t.vault.document} next={t.vault.nextOrPrevious}>
            <DocumentDetail
              key={selected}
              id={selected}
              types={types.data}
              timeZone={tz}
              navigate={navigate}
              onClose={close}
              onChanged={docs.reload}
              onRemoved={(m) => {
                setMessage(m)
                close()
                docs.reload()
              }}
            />
          </DetailPane>
        ) : null
      }
    >
      <PageHeader
        title={t.vault.title}
        description={t.vault.info}
        secondary={
          session.can('data.export' as never)
            ? [{ label: t.common.export, icon: Download, onClick: () => selection.start(EXPORT_MODE), showFrom: 'md', disabled: !docs.data?.total || selection.active }]
            : []
        }
        primary={canUpload ? { label: t.vault.upload, short: t.vault.uploadShort, icon: Upload, onClick: () => setUploading(true) } : undefined}
      />
      <p role="status" className="mb-2 text-sm text-muted-foreground empty:hidden">
        {message}
      </p>

      {/* Search, type and Clear filters on one line where there is room: from sm alone, from xl beside an open document. */}
      <section
        aria-label={t.vault.filters}
        className={cn('mb-4 grid items-start gap-3', beside ? 'xl:grid-cols-[minmax(0,1fr)_12rem_auto]' : 'sm:grid-cols-[minmax(0,1fr)_14rem_auto]')}
      >
        <Field label={t.vault.search} hideLabel>
          {(p) => (
            <Input
              {...controlProps(p)}
              type="search"
              data-shortcut="search"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t.vault.searchPlaceholder}
              autoComplete="off"
            />
          )}
        </Field>
        <Field label={t.vault.type} hideLabel>
          {(p) => (
            <Select
              {...controlProps(p)}
              value={type}
              onChange={(e) => {
                setType(e.target.value)
                setPage(1)
              }}
            >
              <option value="">{t.vault.allTypes}</option>
              {(types.data ?? []).map((ty) => (
                <option key={ty.key} value={ty.key}>
                  {typeLabel(ty.key)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {filtered ? (
          <Button variant="ghost" className="w-full sm:w-auto" onClick={clear}>
            {t.vault.clearFilters}
          </Button>
        ) : null}
      </section>

      <ExportMode selection={selection} list={t.vault.title} columns={vaultExportColumns()} shown={docs.data?.documents ?? []} />
      {docs.data?.near && docs.data.total > 0 ? <p className="mb-2 text-sm text-muted-foreground">{t.vault.near}</p> : null}
      {docs.data && docs.data.identity.length > 0 ? <IdentityRows rows={docs.data.identity} today={today} navigate={navigate} /> : null}
      {docs.error ? (
        <ErrorState error={docs.error} onRetry={docs.reload} />
      ) : !docs.data ? (
        <ListSkeleton />
      ) : docs.data.documents.length === 0 ? (
        <EmptyState
          action={
            filtered ? (
              <Button variant="outline" size="sm" onClick={clear}>
                {t.vault.clearFilters}
              </Button>
            ) : undefined
          }
        >
          {filtered ? t.vault.noMatch : t.vault.noDocuments}
        </EmptyState>
      ) : (
        <>
          <Table stack="list" stackBelow={beside ? 'sm' : 'lg'} busy={docs.loading} stickyHead>
            <TableHeader>
              <TableRow>
                {selection.active ? (
                  <TableHead className={selectCellClass}>
                    <SelectAllCheckbox selection={selection} />
                  </TableHead>
                ) : null}
                <TableHead>{t.vault.colTitle}</TableHead>
                <TableHead>{t.vault.colType}</TableHead>
                {beside ? null : <TableHead>{t.vault.colLinked}</TableHead>}
                <TableHead>{t.vault.colValidUntil}</TableHead>
                {beside ? null : <TableHead>{t.vault.colUpdated}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.data.documents.map((d) => {
                const ends = expiry(d.valid_until, today)
                return (
                  <TableRow
                    key={d.id}
                    data-state={selected === d.id ? 'selected' : undefined}
                    aria-current={selected === d.id ? 'true' : undefined}
                    className={cn(stackedBreak, 'cursor-pointer stacked:hover:bg-muted/50 stacked:data-[state=selected]:bg-muted', selectRowClass(selection, d.id))}
                    onClick={(ev) => {
                      if ((ev.target as Element).closest('a, button, input') || window.getSelection()?.toString()) return
                      open(d.id)
                    }}
                    {...selectRowProps(selection, d.id)}
                  >
                    {selection.active ? (
                      <TableCell className={selectCellClass}>
                        <RowCheckbox selection={selection} id={d.id} name={displayTitle(d)} />
                      </TableCell>
                    ) : null}
                    <TableCell className="whitespace-normal font-medium stacked:order-1 stacked:w-auto stacked:min-w-0 stacked:flex-1">
                      <a {...linkTo({ name: 'vault', document: d.id }, () => open(d.id))} className={linkVariants()}>
                        {displayTitle(d)}
                      </a>
                      {d.sealed ? <Badge variant="outline" className="ml-2 align-middle">{t.vault.sealed}</Badge> : null}
                      {d.number ? <span className="font-normal text-muted-foreground"> · {d.number}</span> : null}
                    </TableCell>
                    <TableCell className="stacked:order-3 stacked:w-auto stacked:text-xs stacked:text-muted-foreground">{typeLabel(d.type)}</TableCell>
                    {beside ? null : (
                      <TableCell className="whitespace-normal stacked:order-3 stacked:w-auto stacked:text-xs stacked:text-muted-foreground stacked:before:mr-1.5 stacked:before:content-['·']">
                        {linkLabels(d.links)}
                      </TableCell>
                    )}
                    <TableCell className="tabular-nums stacked:order-1 stacked:w-auto">
                      {d.valid_until ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="stacked:text-xs stacked:text-muted-foreground">{formatDay(d.valid_until)}</span>
                          {ends === 'expired' ? <Badge variant="destructive">{t.vault.expired}</Badge> : null}
                          {ends === 'soon' ? <Badge variant="outline">{t.vault.expiresSoon}</Badge> : null}
                        </span>
                      ) : null}
                    </TableCell>
                    {beside ? null : (
                      <TableCell className="tabular-nums stacked:hidden">
                        <RelativeDate iso={d.updated_at} timeZone={tz} />
                      </TableCell>
                    )}
                    <TableCell aria-hidden className="hidden w-auto text-muted-foreground stacked:order-1 stacked:block stacked:w-auto">
                      <ChevronRight className="size-4" />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <nav className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label={t.vault.pages}>
            <span className="text-muted-foreground">
              {t.vault.documents(docs.data.total)} · {t.vault.pageOf(page, pages)}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t.vault.previous}
              </Button>
              <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                {t.vault.next}
              </Button>
            </div>
          </nav>
        </>
      )}
      <DocumentDetailsSheet
        sheet={uploading ? fromScreen : null}
        types={types.data}
        onClose={() => setUploading(false)}
        onSaved={(d, m) => {
          setUploading(false)
          setMessage(m)
          docs.reload()
          open(d.id)
        }}
      />
    </ListDetail>
  )
}

/**
 * The ID documents of the employees the search is about (Personnel files,
 * metadata only): each opens the holder's page at its Identity section; the
 * Document Vault keeps, opens and downloads none of them.
 */
function IdentityRows({ rows, today, navigate }: { rows: readonly VaultIdentityRow[]; today: string; navigate: (to: Route) => void }) {
  return (
    <section aria-labelledby="vault-identity" className="mb-4 rounded-md border border-border p-3">
      <h2 id="vault-identity" className="mb-2 flex items-center gap-1 text-sm font-semibold">
        {t.vault.identityTitle}
        <InfoTip section={t.vault.identityTitle}>{t.vault.identityInfo}</InfoTip>
      </h2>
      <ul className="flex flex-col gap-1.5 text-sm">
        {identityLines(rows, today).map((r) => {
          const kind = t.identity.kinds[r.kind] ?? r.kind
          const until = formatDay(r.expires_on)
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <a
                {...linkTo({ name: 'employeePage', id: r.employee_id, from: t.vault.title, section: 'identity' }, navigate)}
                aria-label={t.vault.identityOpen(r.holder)}
                className={cn(linkVariants({ weight: 'medium' }), 'inline-flex min-h-11 items-center md:min-h-0')}
              >
                {r.holder}
              </a>
              <span className={r.expired && !r.superseded ? 'text-warning' : 'text-muted-foreground'}>
                {r.expired ? t.identity.expiredOn(kind, r.issuing_state, until) : t.identity.validUntil(kind, r.issuing_state, until)}
              </span>
              {r.superseded ? <Badge variant="secondary">{t.vault.superseded}</Badge> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
