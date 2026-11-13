import type { IdentityDocumentKind, KeptScan } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import type { Turn } from '@ppe/mrz/reader'
import type { Quad } from '@ppe/scan-kit/perspective'
import { usePictureStore } from '@ppe/scan-kit/pictures'
import { Button } from '@ppe/ui/components/button'
import { Field, Input, Select, controlProps } from '@ppe/ui/components/field'
import { ActionError, PageHeader } from '@ppe/ui/components/states'
import { saveFile } from '@ppe/ui/lib/save-file'
import { Camera, CircleCheck, Download, ImagePlus, TriangleAlert, UserRoundPlus } from 'lucide-react'
import { useEffect, useReducer, useRef, useState } from 'react'

import { t } from '@/i18n'
import { makePage, type MakeOptions } from '@/lib/make-page'
import {
  archiveName,
  detailsAgreed,
  detailsOf,
  docTypeOf,
  emptyBatch,
  MAX_PAGES,
  readPageOf,
  scanBatch,
  scanBlockers,
  unsavedWork,
} from '@/lib/scan'

import type { ImportStart } from '../import/import-page'
import { CornerEditor } from './corner-editor'
import { PageCard } from './page-card'
import { RecentScans } from './recent-scans'

/**
 * Scan Document: one person's passport or ID card photographed page by page
 * (chosen from photos, or taken one by one). Each photo is made into a page in
 * the browser, one after another: turned the way up its code lines read,
 * its corners found and flattened (lib/make-page.ts). The pages show one under
 * another, each with Turn Left, Turn Right, Adjust Corners and Remove; the
 * names read from the code lines name the archive and may be typed over.
 * Download Archive keeps the pages on the server as a zip for a few days (the
 * maker's alone, Recent scans) and downloads it; Save to Personnel hands the
 * pages to Import to Personnel. Pictures live in this screen's memory only.
 */
export function ScanPage({ onSaveToPersonnel }: { onSaveToPersonnel: (start: ImportStart) => void }) {
  const { client } = useApi()
  const [batch, dispatch] = useReducer(scanBatch, emptyBatch)
  const pictures = usePictureStore()
  const files = useRef(new Map<string, Blob>())
  const latest = useRef(batch)
  latest.current = batch
  const queue = useRef<Promise<void>>(Promise.resolve())
  const camera = useRef<HTMLInputElement>(null)
  const chooser = useRef<HTMLInputElement>(null)
  const [kept, setKept] = useState<KeptScan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [recent, setRecent] = useState(0)

  // Pictures no page shows any more go, and their files with them.
  useEffect(() => {
    if (batch.released.length === 0) return
    pictures.forget(batch.released)
    for (const id of batch.released) files.current.delete(id)
    dispatch({ type: 'released', ids: batch.released })
  }, [batch.released, pictures])

  // A change to the pages or names after Download Archive: what was kept is not this any more.
  useEffect(() => setKept(null), [batch.pages, batch.typed])

  const unsaved = unsavedWork(batch, kept !== null)
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  const details = detailsOf(batch)
  const blockers = scanBlockers(batch)
  const working = batch.pages.filter((p) => p.status === 'working').length

  /** Makes source's page, after any page being made: one at a time, as the reader reads one photo at a time. */
  const make = (source: string, o: Omit<MakeOptions, 'kind'> = {}) => {
    queue.current = queue.current.then(async () => {
      const photo = files.current.get(source)
      if (!photo || !latest.current.pages.some((p) => p.source === source)) return
      try {
        const made = await makePage(photo, { ...o, kind: detailsOf(latest.current).kind })
        const page = crypto.randomUUID()
        files.current.set(page, made.blob)
        pictures.keep(page, made.blob)
        dispatch({
          type: 'done',
          source,
          page,
          turn: made.turn,
          corners: made.corners,
          size: made.size,
          confidence: made.confidence,
          ...(made.reading ? { reading: made.reading } : {}),
        })
      } catch {
        dispatch({ type: 'failed', source })
      }
    })
  }

  const addPhotos = (list: FileList | null) => {
    if (!list || list.length === 0) return
    setError(null)
    const room = Math.max(0, MAX_PAGES - latest.current.pages.length)
    const sources = [...list].map((file) => {
      const id = crypto.randomUUID()
      files.current.set(id, file)
      return id
    })
    dispatch({ type: 'add', sources })
    for (const source of sources.slice(0, room)) make(source)
  }

  const turn = (source: string, clockwise: boolean) => {
    const page = batch.pages.find((p) => p.source === source)
    if (!page) return
    const next = ((page.turn + (clockwise ? 90 : 270)) % 360) as Turn
    dispatch({ type: 'working', source, turn: next })
    const format = page.reading?.band?.format
    make(source, { turn: next, ...(format ? { format } : {}) })
  }

  const setCorners = (source: string, corners: Quad) => {
    const page = batch.pages.find((p) => p.source === source)
    setEditing(null)
    if (!page) return
    dispatch({ type: 'working', source })
    const format = page.reading?.band?.format
    make(source, { turn: page.turn, corners, ...(format ? { format } : {}) })
  }

  const donePages = () => batch.pages.filter((p) => p.status === 'done' && p.page && files.current.has(p.page))

  const download = async () => {
    setBusy(true)
    setError(null)
    try {
      let scan = kept
      if (!scan) {
        const m = readPageOf(batch.pages)?.reading?.mrz
        scan = await client.personnel.scans.keep(
          {
            surname: details.surname.trim(),
            given_names: details.givenNames.trim(),
            kind: details.kind,
            number: details.number.replace(/[^A-Za-z0-9]/g, '').toUpperCase(),
            // The lines checked by the API, when they read valid; never kept.
            ...(m?.valid ? { mrz: m.lines } : {}),
          },
          donePages().map((p) => files.current.get(p.page!)!),
        )
        setKept(scan)
        setRecent((n) => n + 1)
      }
      const { blob, fileName } = await client.personnel.scans.download(scan.id)
      saveFile(blob, fileName)
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const toPersonnel = () => {
    const pages = donePages().map((p) => ({ blob: files.current.get(p.page!)!, ...(p.reading ? { reading: p.reading } : {}) }))
    onSaveToPersonnel({ type: docTypeOf(details.kind), pages })
    dispatch({ type: 'clear' })
  }

  const editingPage = editing ? batch.pages.find((p) => p.source === editing) : undefined
  const source = editingPage ? files.current.get(editingPage.source) : undefined

  return (
    <>
      <PageHeader title={t.scan.title} description={t.scan.description} />
      <section className="flex max-w-3xl flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => chooser.current?.click()} disabled={batch.pages.length >= MAX_PAGES}>
              <ImagePlus aria-hidden className="size-4" />
              {batch.pages.length > 0 ? t.scan.addPhotos : t.scan.choosePhotos}
            </Button>
            <Button variant="outline" onClick={() => camera.current?.click()} disabled={batch.pages.length >= MAX_PAGES}>
              <Camera aria-hidden className="size-4" />
              {t.scan.takePhoto}
            </Button>
            <input
              ref={chooser}
              type="file"
              accept="image/*"
              multiple
              hidden
              aria-label={t.scan.choosePhotos}
              onChange={(e) => {
                addPhotos(e.target.files)
                e.target.value = ''
              }}
            />
            {/* capture="environment": the phone's back camera; on a computer, a file chooser. */}
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              aria-label={t.scan.takePhoto}
              onChange={(e) => {
                addPhotos(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
          <p className="text-sm text-muted-foreground">{t.scan.photosHint}</p>
          {working > 0 ? (
            <p role="status" className="text-sm">
              {t.scan.making(batch.pages.length - working, batch.pages.length)}
            </p>
          ) : null}
          {batch.notice === 'too_many' ? (
            <p role="alert" className="text-sm text-warning">
              {t.scan.tooMany}
            </p>
          ) : null}
        </div>

        {batch.pages.length > 0 ? (
          <>
            <Details
              surname={details.surname}
              givenNames={details.givenNames}
              kind={details.kind}
              number={details.number}
              status={readPageOf(batch.pages) ? (detailsAgreed(batch.pages) ? 'agreed' : 'check') : 'none'}
              fileName={kept?.file_name ?? (details.surname.trim() ? archiveName(details) : '')}
              onChange={(d) => dispatch({ type: 'typed', details: d })}
            />

            <section aria-labelledby="scan-pages" className="flex flex-col gap-3">
              <h2 id="scan-pages" className="text-base font-semibold">
                {t.scan.pagesTitle}
              </h2>
              <ol className="flex flex-col gap-4">
                {batch.pages.map((p, i) => (
                  <PageCard
                    key={p.source}
                    n={i + 1}
                    page={p}
                    src={pictures.url(p.page)}
                    onTurn={(clockwise) => turn(p.source, clockwise)}
                    onAdjust={() => setEditing(p.source)}
                    onRemove={() => dispatch({ type: 'remove', source: p.source })}
                  />
                ))}
              </ol>
            </section>

            {blockers.length > 0 ? (
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                {blockers
                  .filter((b) => b !== 'no_pages' || batch.pages.length === 0)
                  .map((b) => (
                    <li key={b}>{t.scan.blockers[b]}</li>
                  ))}
              </ul>
            ) : null}
            <ActionError error={error} />
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button onClick={() => void download()} disabled={busy || blockers.length > 0}>
                <Download aria-hidden className="size-4" />
                {busy ? t.scan.downloading : t.scan.download}
              </Button>
              <Button variant="outline" onClick={toPersonnel} disabled={busy || blockers.length > 0}>
                <UserRoundPlus aria-hidden className="size-4" />
                {t.scan.saveToPersonnel}
              </Button>
              <Button variant="ghost" onClick={() => dispatch({ type: 'clear' })} disabled={busy}>
                {t.scan.clear}
              </Button>
            </div>
            {kept ? <p className="text-sm text-muted-foreground">{t.scan.keptNote}</p> : null}
          </>
        ) : null}

        <RecentScans refresh={recent} />
      </section>

      {editingPage?.corners && editingPage.size && source ? (
        <CornerEditor
          photo={source}
          turn={editingPage.turn}
          corners={editingPage.corners}
          size={editingPage.size}
          onDone={(c) => setCorners(editingPage.source, c)}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </>
  )
}

/** What names the archive: read from the code lines, typed over when they are wrong or missing. */
function Details({
  surname,
  givenNames,
  kind,
  number,
  status,
  fileName,
  onChange,
}: {
  surname: string
  givenNames: string
  kind: IdentityDocumentKind
  number: string
  status: 'agreed' | 'check' | 'none'
  fileName: string
  onChange: (d: Partial<{ surname: string; givenNames: string; kind: IdentityDocumentKind; number: string }>) => void
}) {
  const note = status === 'agreed' ? t.scan.readAgreed : status === 'check' ? t.scan.checkThis : t.scan.notRead
  return (
    <section aria-labelledby="scan-details" className="flex flex-col gap-3 rounded-md border border-border p-4">
      <h2 id="scan-details" className="text-base font-semibold">
        {t.scan.detailsTitle}
      </h2>
      <p className={`flex items-start gap-1.5 text-sm ${status === 'agreed' ? 'text-success' : 'text-warning'}`}>
        {status === 'agreed' ? <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" /> : <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />}
        {note}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.scan.surname} required>
          {(p) => <Input {...controlProps(p)} autoComplete="off" value={surname} onChange={(e) => onChange({ surname: e.target.value })} />}
        </Field>
        <Field label={t.scan.givenNames}>
          {(p) => <Input {...controlProps(p)} autoComplete="off" value={givenNames} onChange={(e) => onChange({ givenNames: e.target.value })} />}
        </Field>
        <Field label={t.scan.kind}>
          {(p) => (
            <Select {...controlProps(p)} value={kind} onChange={(e) => onChange({ kind: e.target.value as IdentityDocumentKind })}>
              <option value="passport">{t.kinds.passport}</option>
              <option value="id_card">{t.kinds.id_card}</option>
              <option value="residence_permit">{t.kinds.residence_permit}</option>
            </Select>
          )}
        </Field>
        <Field label={t.scan.number}>
          {(p) => <Input {...controlProps(p)} autoComplete="off" className="font-mono" value={number} onChange={(e) => onChange({ number: e.target.value })} />}
        </Field>
      </div>
      {fileName ? (
        <p className="text-sm">
          <span className="text-muted-foreground">{t.scan.fileName}: </span>
          <span className="font-mono break-all">{fileName}</span>
        </p>
      ) : null}
    </section>
  )
}
