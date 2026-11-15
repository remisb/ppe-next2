import { type RowMark, type ScanCard, blocks, simScanText } from '@ppe/sim-scan'
import { message } from '@ppe/sim-scan/review-list'
import { Thumb } from '@ppe/scan-kit/thumb'
import { Segmented } from '@ppe/ui/components/segmented'
import { cn } from '@ppe/ui/lib/utils'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

type Filter = 'all' | 'fix' | 'no_back'

/**
 * The review list on a phone: the SIMs that need fixing first, then the rest
 * newest first, each a row that opens the card's sheet (as on the camera) to
 * check, correct or remove it. Filters for what is there: All, To fix, No
 * back; one with nothing in it is not offered, and falls back to All.
 */
export function PhoneReview({
  cards,
  marks,
  pictures,
  onOpen,
}: {
  cards: readonly ScanCard[]
  marks: readonly RowMark[][]
  pictures: ReadonlyMap<string, string>
  onOpen: (index: number) => void
}) {
  const t = simScanText()
  const [asked, setAsked] = useState<Filter>('all')
  const rows = cards.map((card, index) => {
    const row = marks[index] ?? []
    const problem = row.find(blocks)
    const noBack = row.some((m) => m.code === 'no_back')
    return { card, index, row, problem, noBack, fix: problem !== undefined || card.unread === true }
  })
  const fix = rows.filter((r) => r.fix)
  const noBack = rows.filter((r) => !r.fix && r.noBack)
  const filter: Filter = (asked === 'fix' && fix.length === 0) || (asked === 'no_back' && noBack.length === 0) ? 'all' : asked
  const ready = rows.filter((r) => !r.fix && (filter !== 'no_back' || r.noBack)).reverse()

  const options = [
    { value: 'all' as const, label: t.filterAll, count: cards.length },
    ...(fix.length > 0 ? [{ value: 'fix' as const, label: t.filterFix, count: fix.length }] : []),
    ...(noBack.length > 0 ? [{ value: 'no_back' as const, label: t.filterNoBack, count: noBack.length }] : []),
  ]

  const line = (r: (typeof rows)[number]) => {
    const note = r.row.find((m) => !blocks(m))
    const said = r.problem ? message(r.problem) : r.card.unread ? t.problems.unread : note ? message(note) : `${t.pin} ${r.card.pin} · ${t.puk} ${r.card.puk}`
    return (
      <li key={r.card.key}>
        <button
          type="button"
          aria-label={t.checkCard(r.index + 1)}
          onClick={() => onOpen(r.index)}
          data-testid="scan-row"
          className={cn(
            'flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left',
            r.fix ? 'rounded-xl border border-destructive/30 bg-destructive/10' : 'bg-card',
          )}
        >
          <Thumb src={r.card.front ? pictures.get(r.card.front) : undefined} alt="" className="h-9 w-14 shrink-0" />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-sm whitespace-nowrap" data-testid="sim-no">
              {r.card.simNo || '–'}
            </span>
            <span className={cn('truncate text-xs', r.fix ? 'text-destructive' : note || r.noBack ? 'text-warning' : 'text-muted-foreground')}>{said}</span>
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">{r.index + 1}</span>
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {options.length > 1 ? <Segmented label={t.filterLabel} options={options} value={filter} onChange={setAsked} layout="fit" /> : null}
      {fix.length > 0 && filter !== 'no_back' ? (
        <section aria-labelledby="to-fix" className="flex flex-col gap-1.5">
          <h3 id="to-fix" className="text-sm font-semibold text-destructive">
            {t.needsFixing(fix.length)}
          </h3>
          <ul className="flex flex-col gap-1.5">{fix.map(line)}</ul>
        </section>
      ) : null}
      {ready.length > 0 && filter !== 'fix' ? (
        <section aria-labelledby="ready" className="flex flex-col gap-1.5">
          <h3 id="ready" className="text-sm font-semibold text-muted-foreground">
            {filter === 'no_back' ? t.problems.no_back : t.readyNewestFirst(ready.length)}
          </h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">{ready.map(line)}</ul>
        </section>
      ) : null}
    </div>
  )
}
