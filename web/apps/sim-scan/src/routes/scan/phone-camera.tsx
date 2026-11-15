import type { Settings } from '@ppe/api-client'
import { formatEuro } from '@ppe/i18n'
import { type BatchSettings, MAX_CARDS, type RowMark, type ScanCard, blocks, simKey, simScanText } from '@ppe/sim-scan'
import { message } from '@ppe/sim-scan/review-list'
import { Button } from '@ppe/ui/components/button'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { cn } from '@ppe/ui/lib/utils'
import { ChevronDown, CircleAlert, CircleCheck, Copy, ImagePlus, Info, Redo2, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { BatchFacts, BatchForm } from './batch-card'
import { CardSheet } from './card-sheet'
import { type Guide, useLiveScan } from './use-live-scan'

/** A carrier's shape, ID-1 (85.6 × 54 mm), held across. */
const CARD = 85.6 / 54

/**
 * The guide frame in a viewfinder of width × height: the card's shape, as wide
 * as 88% of the width or 70% of the height allow, in the middle. The frame
 * drawn over the picture is the same, in container units (cqw, cqh).
 */
export function cardGuide(width: number, height: number): Guide {
  const w = Math.min(0.88 * width, 0.7 * CARD * height)
  const h = w / CARD
  return { x: (width - w) / 2 / width, y: (height - h) / 2 / height, w: w / width, h: h / height }
}

/** How many of the newest cards show above the camera. */
const SHOWN = 5

/**
 * Scan SIMs on a phone, as a camera app: full screen, the newest SIMs above
 * the viewfinder as they are read (a tap opens one to check, correct or
 * remove), FRONT or BACK under it, and the controls at the thumb: the last
 * card's picture with the count (back to the list, to review and add), Read
 * Now and No Back. Before the first card it shows what every SIM gets, with
 * Change. A modal <dialog>, so Escape and Close end it and nothing behind it
 * takes the focus; the camera runs while it is mounted.
 */
export function PhoneCamera({
  cards,
  marks,
  pictures,
  settings,
  batch,
  onBatch,
  onCard,
  onUpdate,
  onRemove,
  onChoosePhotos,
  existingHref,
  onClose,
}: {
  cards: readonly ScanCard[]
  marks: readonly RowMark[][]
  /** Each picture's thumbnail (a blob: URL), by its id. */
  pictures: ReadonlyMap<string, string>
  settings: Settings | null
  batch: BatchSettings
  onBatch: (batch: BatchSettings) => void
  onCard: (card: ScanCard, front: Blob, back: Blob | null) => void
  onUpdate: (index: number, patch: Partial<Pick<ScanCard, 'simNo' | 'pin' | 'puk'>>) => void
  onRemove: (index: number) => void
  /** The camera did not start: photos chosen instead. */
  onChoosePhotos: (files: FileList | null) => void
  existingHref: (id: string) => string
  onClose: () => void
}) {
  const t = simScanText()
  const dialog = useRef<HTMLDialogElement>(null)
  // Its own: outside the modal dialog, the page's input is inert.
  const photos = useRef<HTMLInputElement>(null)
  const [editingBatch, setEditingBatch] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const full = cards.length >= MAX_CARDS
  const scan = useLiveScan({ known: cards.map((c) => simKey(c.simNo)), onCard, guide: cardGuide })

  useEffect(() => {
    const d = dialog.current
    if (d && !d.open) d.showModal()
    return () => d?.close()
  }, [])

  const n = cards.length
  const toFix = marks.filter((row) => row.some(blocks)).length
  const first = n - Math.min(n, SHOWN)
  const last = cards.at(-1)
  const lastPicture = last?.front ? pictures.get(last.front) : undefined
  const back = scan.side === 'back'
  const corner = scan.justRead ? 'border-success' : back ? 'border-warning' : 'border-white'
  const chip = [batch.provider || t.provider, batch.valueCents === null ? '' : formatEuro(batch.valueCents)].filter((x) => x !== '').join(' · ')

  return (
    <dialog
      ref={dialog}
      aria-label={t.scanTitle}
      className="dark m-0 h-dvh max-h-none w-full max-w-none border-0 bg-black p-0 text-white backdrop:bg-black"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="flex h-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-2">
          <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label={t.closeCamera} title={t.closeCamera} onClick={onClose}>
            <X aria-hidden className="size-5" />
          </Button>
          <h2 className="truncate text-base font-semibold">{t.scanTitle}</h2>
          <button
            type="button"
            className="flex h-11 max-w-[45%] items-center gap-1.5 rounded-full border border-border bg-muted px-3 text-sm font-medium"
            aria-label={`${t.editBatch}: ${chip}`}
            onClick={() => setEditingBatch(true)}
          >
            <span className="truncate">{chip}</span>
            <ChevronDown aria-hidden className="size-4 shrink-0" />
          </button>
        </header>

        {/* Its content sits at the bottom, by the camera (mt-auto), and scrolls when taller than the room left. */}
        <section aria-label={t.cards(n)} className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2">
          {n === 0 ? (
            <div className="mt-auto flex flex-col gap-3 px-1 pt-2 pb-1">
              <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-muted/60 py-2.5 pr-2 pl-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{t.everySimGets}</span>
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditingBatch(true)}>
                    {t.changeBatch}
                  </Button>
                </div>
                <BatchFacts batch={batch} className="pr-2" />
              </div>
              <p className="text-sm text-muted-foreground">{t.firstHint}</p>
            </div>
          ) : (
            <>
              <div className="mt-auto flex items-baseline justify-between px-1 pt-2 pb-2 text-sm">
                <span className="text-muted-foreground">{t.cards(n)}</span>
                {toFix > 0 ? <span className="font-medium text-destructive">{t.toFix(toFix)}</span> : null}
              </div>
              <ol className="flex flex-col gap-1">
                {cards.slice(first).map((c, k) => {
                  const i = first + k
                  const row = marks[i] ?? []
                  const problem = row.find(blocks)
                  const note = row.find((m) => !blocks(m))
                  const newest = i === n - 1
                  const said = problem ? message(problem) : c.unread ? t.problems.unread : note ? message(note) : `${t.pin} ${c.pin} · ${t.puk} ${c.puk}`
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        aria-label={t.checkCard(i + 1)}
                        onClick={() => setOpen(i)}
                        className={cn(
                          'flex min-h-12 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left',
                          problem ? 'bg-destructive/15' : newest ? 'bg-success/15' : 'bg-muted/60',
                        )}
                      >
                        <span className="w-6 shrink-0 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="font-mono text-sm whitespace-nowrap">{c.simNo || '–'}</span>
                          <span className={cn('truncate text-xs', problem ? 'text-destructive' : note || c.unread ? 'text-warning' : 'text-muted-foreground')}>{said}</span>
                        </span>
                        {problem ? (
                          <CircleAlert aria-hidden className="size-5 shrink-0 text-destructive" />
                        ) : note || c.unread ? (
                          <Info aria-hidden className="size-5 shrink-0 text-warning" />
                        ) : (
                          <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ol>
            </>
          )}
        </section>

        <div className="relative mx-3 h-[min(340px,46dvh)] shrink-0 overflow-hidden rounded-3xl bg-card [container-type:size]">
          <video ref={scan.video} className="size-full object-cover" playsInline muted />
          {scan.problem ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <p role="alert" className="text-sm">
                {scan.problem}
              </p>
              <Button variant="outline" onClick={() => photos.current?.click()}>
                <ImagePlus aria-hidden className="size-4" />
                {t.choosePhotos}
              </Button>
              <input
                ref={photos}
                type="file"
                accept="image/*"
                multiple
                hidden
                aria-label={t.choosePhotos}
                onChange={(e) => {
                  onChoosePhotos(e.target.files)
                  e.target.value = ''
                }}
              />
            </div>
          ) : (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ width: `min(88cqw, ${(70 * CARD).toFixed(2)}cqh)`, aspectRatio: `${CARD}` }}
              >
                <span className={cn('absolute top-0 left-0 size-8 rounded-tl-2xl border-t-4 border-l-4 transition-colors', corner)} />
                <span className={cn('absolute top-0 right-0 size-8 rounded-tr-2xl border-t-4 border-r-4 transition-colors', corner)} />
                <span className={cn('absolute bottom-0 left-0 size-8 rounded-bl-2xl border-b-4 border-l-4 transition-colors', corner)} />
                <span className={cn('absolute right-0 bottom-0 size-8 rounded-br-2xl border-r-4 border-b-4 transition-colors', corner)} />
              </div>
              <span className="absolute top-3 left-3 flex h-7 items-center gap-1.5 rounded-full bg-black/55 px-2.5 text-xs font-medium">
                <span aria-hidden className={cn('size-2 rounded-full', back ? 'bg-warning' : 'bg-white')} />
                {t.sideStep(n + 1, back)}
              </span>
              {scan.torch.available ? (
                <button
                  type="button"
                  aria-label={t.torch}
                  title={t.torch}
                  aria-pressed={scan.torch.on}
                  onClick={scan.torch.toggle}
                  className={cn('absolute top-2 right-2 flex size-11 items-center justify-center rounded-full', scan.torch.on ? 'bg-warning text-black' : 'bg-black/55')}
                >
                  <Zap aria-hidden className="size-5" />
                </button>
              ) : null}
              {scan.duplicateOf !== null ? (
                <p role="alert" className="absolute inset-x-4 top-14 flex items-center gap-2.5 rounded-xl bg-warning px-3 py-2.5 text-sm font-semibold text-warning-foreground">
                  <Copy aria-hidden className="size-5 shrink-0" />
                  {t.notTakenAgain(scan.duplicateOf + 1)}
                </p>
              ) : null}
              <p
                role="status"
                aria-live="polite"
                className={cn('absolute inset-x-4 bottom-3 rounded-xl px-3 py-2 text-center text-sm leading-snug', scan.justRead ? 'bg-success/90 text-success-foreground' : 'bg-black/60')}
              >
                {full ? t.tooMany(MAX_CARDS) : scan.status}
              </p>
            </>
          )}
        </div>

        <div aria-hidden className="flex h-10 shrink-0 items-center justify-center gap-7 text-sm font-semibold tracking-wider uppercase">
          <span className={back ? 'text-muted-foreground' : 'text-warning'}>{t.front}</span>
          <span className={back ? 'text-warning' : 'text-muted-foreground'}>{t.back}</span>
        </div>

        <div className="grid h-28 shrink-0 grid-cols-3 items-center justify-items-center px-4 pb-3">
          <button
            type="button"
            aria-label={t.reviewCards(n)}
            title={t.reviewCards(n)}
            disabled={n === 0}
            onClick={onClose}
            className="relative size-14 rounded-xl border-2 border-white bg-muted disabled:opacity-35"
          >
            {lastPicture ? <img src={lastPicture} alt="" className="size-full rounded-[10px] object-cover" /> : null}
            {n > 0 ? (
              <span className="absolute -top-2 -right-2 flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-black tabular-nums">
                {n}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            aria-label={t.readNow}
            title={t.readNow}
            disabled={scan.problem !== null || full}
            onClick={scan.readNow}
            className="flex size-[78px] items-center justify-center rounded-full border-4 border-white p-1 disabled:opacity-35"
          >
            <span aria-hidden className={cn('size-full rounded-full transition-colors', scan.justRead ? 'bg-success' : 'bg-white')} />
          </button>
          <button
            type="button"
            disabled={!back}
            onClick={scan.noBack}
            className="flex min-h-16 w-24 flex-col items-center justify-center gap-1 text-center text-xs leading-tight font-medium disabled:opacity-35"
          >
            <span aria-hidden className="flex size-9 items-center justify-center rounded-full bg-muted">
              <Redo2 className="size-4" />
            </span>
            {t.skipBack}
          </button>
        </div>
      </div>

      <FormSheet open={editingBatch} onClose={() => setEditingBatch(false)} title={t.batch}>
        {editingBatch ? (
          <BatchForm
            settings={settings}
            batch={batch}
            onSave={(b) => {
              onBatch(b)
              setEditingBatch(false)
            }}
            onCancel={() => setEditingBatch(false)}
          />
        ) : null}
      </FormSheet>

      {open !== null && cards[open] ? (
        <CardSheet
          n={open + 1}
          card={cards[open]}
          marks={marks[open] ?? []}
          pictures={pictures}
          existingHref={existingHref}
          onChange={(patch) => onUpdate(open, patch)}
          onRemove={() => {
            onRemove(open)
            setOpen(null)
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </dialog>
  )
}
