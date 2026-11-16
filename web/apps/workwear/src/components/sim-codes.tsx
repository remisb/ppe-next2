import { type Asset, ApiError, type SimCodes } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { CopyButton } from '@ppe/ui/components/copy-button'
import { FormSheet } from '@ppe/ui/components/form-sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@ppe/ui/components/tooltip'
import { formatTime } from '@ppe/ui/lib/dates'
import { KeyRound } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'

import { t } from '@/i18n'
import { minutesSeconds } from '@/lib/assets'

/** How long shown codes stay on screen: they close by themselves after it, as in Scan SIMs. */
export const CODES_SHOWN_SECONDS = 60

/**
 * Show PIN and PUK (WARE-37): a key among a SIM card's actions, for whoever
 * sees SIM cards, and the window it opens. The codes are asked for only on
 * the click, which the API records (asset.sim_codes_shown, the card's
 * Changes), and are dropped from the page when the window closes: Done, ✕,
 * Escape, CODES_SHOWN_SECONDS, or the tab going to the background. A card
 * with none has the key greyed out, its tooltip saying so.
 */
export function SimCodesKey({
  asset,
  timeZone,
  onShown,
  onMissing,
  onError,
}: {
  asset: Asset
  timeZone: string | undefined
  /** The codes were shown, so recorded: the card's Changes load again. */
  onShown: () => void
  /** The card has no codes after all (someone removed them meanwhile): say so and load it again. */
  onMissing: (message: string) => void
  onError: (err: unknown) => void
}) {
  const { client } = useApi()
  const reasonId = useId()
  const [codes, setCodes] = useState<SimCodes | null>(null)
  const [shownAt, setShownAt] = useState('')
  const [busy, setBusy] = useState(false)
  // Stable, so the window's minute is not started again on every render.
  const close = useCallback(() => setCodes(null), [])

  const show = async () => {
    setBusy(true)
    try {
      const c = await client.assets.showSimCodes(asset.id)
      setShownAt(new Date().toISOString())
      setCodes(c)
      onShown()
    } catch (err) {
      if (err instanceof ApiError && err.isNotFound) onMissing(t.assets.codesNoneNow(asset.inventory_no))
      else onError(err)
    } finally {
      setBusy(false)
    }
  }

  const key = <KeyRound aria-hidden />
  return (
    <>
      {asset.has_sim_codes ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="outline" size="icon" aria-label={t.assets.showCodes} disabled={busy} onClick={() => void show()}>
                {key}
              </Button>
            }
          />
          <TooltipContent aria-hidden>{busy ? t.assets.showingCodes : t.assets.showCodes}</TooltipContent>
        </Tooltip>
      ) : (
        // A disabled button takes no pointer, so its tooltip hangs on a wrapper; a screen reader hears why from the button.
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <Button variant="outline" size="icon" disabled aria-label={t.assets.showCodes} aria-describedby={reasonId}>
              {key}
            </Button>
          </TooltipTrigger>
          <TooltipContent aria-hidden>{t.assets.noCodes}</TooltipContent>
          <span id={reasonId} hidden>
            {t.assets.noCodes}
          </span>
        </Tooltip>
      )}
      <SimCodesSheet asset={asset} codes={codes} shownAt={shownAt} timeZone={timeZone} onClose={close} />
    </>
  )
}

/**
 * The window with a card's PIN and PUK: which card (inventory and phone
 * numbers, the SIM No.), each code large with its copy button at the row's
 * end, and when it was recorded and closes. A bottom sheet on a phone, a
 * centred dialog from md (FormSheet), which hands focus back to the key.
 */
function SimCodesSheet({
  asset,
  codes,
  shownAt,
  timeZone,
  onClose,
}: {
  asset: Asset
  codes: SimCodes | null
  shownAt: string
  timeZone: string | undefined
  onClose: () => void
}) {
  const open = codes !== null
  const [left, setLeft] = useState(CODES_SHOWN_SECONDS)
  const [copied, setCopied] = useState('')

  // A fresh minute each time it opens; then it closes by itself, or as soon as the tab is in the background.
  useEffect(() => {
    if (!open) return
    setLeft(CODES_SHOWN_SECONDS)
    setCopied('')
    const started = Date.now()
    const tick = window.setInterval(() => {
      const rest = CODES_SHOWN_SECONDS - Math.floor((Date.now() - started) / 1000)
      if (rest <= 0) onClose()
      else setLeft(rest)
    }, 1000)
    const onVisibility = () => document.visibilityState === 'hidden' && onClose()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(tick)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [open, onClose])

  const which = [asset.inventory_no, asset.phone_no].filter(Boolean).join(' · ')
  const copiedAs = (message: string) => (ok: boolean) => setCopied(ok ? message : t.assets.copyFailed)
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={t.assets.codesTitle}
      description={which}
      footer={
        <Button onClick={onClose}>
          {t.assets.codesDone}
        </Button>
      }
    >
      {codes ? (
        <div className="flex flex-col gap-5">
          {asset.sim_no ? (
            <p className="-mt-2 text-sm text-muted-foreground">
              {t.assets.simNo} <span className="font-mono text-foreground">{asset.sim_no}</span>
            </p>
          ) : null}
          <CodeRow label="PIN" code={codes.pin} copyLabel={t.assets.copyPin} onCopied={copiedAs(t.assets.pinCopied)} />
          <CodeRow label="PUK" code={codes.puk} copyLabel={t.assets.copyPuk} onCopied={copiedAs(t.assets.pukCopied)} />
          <div className="flex flex-col gap-1.5">
            <div aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-foreground transition-[width] duration-1000 ease-linear motion-reduce:transition-none" style={{ width: `${(left / CODES_SHOWN_SECONDS) * 100}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t.assets.codesRecorded(formatTime(shownAt, timeZone))}{' '}
              <span aria-hidden>{t.assets.codesCloseIn(minutesSeconds(left))}</span>
            </p>
            <p role="status" className="text-xs empty:hidden">
              {copied}
            </p>
          </div>
        </div>
      ) : null}
    </FormSheet>
  )
}

/** One code: its name, its digits large in groups of four, and its copy button at the row's end. */
function CodeRow({ label, code, copyLabel, onCopied }: { label: string; code: string; copyLabel: string; onCopied: (ok: boolean) => void }) {
  const groups = code.match(/.{1,4}/g) ?? []
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center justify-between gap-2">
        <p className="flex gap-2 sm:gap-3">
          <span className="sr-only">{code}</span>
          {groups.map((g, i) => (
            <span key={i} aria-hidden className="flex gap-1 sm:gap-1.5">
              {[...g].map((d, j) => (
                <span key={j} className="flex h-11 w-7 items-center justify-center rounded-md border bg-background font-mono text-xl font-medium sm:h-12 sm:w-9 sm:text-2xl">
                  {d}
                </span>
              ))}
            </span>
          ))}
        </p>
        <CopyButton text={code} label={copyLabel} onCopied={onCopied} />
      </div>
    </div>
  )
}
