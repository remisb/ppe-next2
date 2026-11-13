import { CONFIDENT } from '@ppe/scan-kit/perspective'
import { Button } from '@ppe/ui/components/button'
import { CircleCheck, Crop, RotateCcw, RotateCw, Trash2, TriangleAlert } from 'lucide-react'

import { t } from '@/i18n'
import type { ScanPage } from '@/lib/scan'

/**
 * One page of Scan Document, full width: the flattened page (or its state
 * while it is made), what was found on it, and its actions. A page whose
 * corners were hard to find says Check corners.
 */
export function PageCard({
  n,
  page,
  src,
  onTurn,
  onAdjust,
  onRemove,
}: {
  n: number
  page: ScanPage
  src: string | undefined
  onTurn: (clockwise: boolean) => void
  onAdjust: () => void
  onRemove: () => void
}) {
  const working = page.status === 'working'
  const unsure = page.status === 'done' && page.confidence < CONFIDENT
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3" aria-busy={working || undefined}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{t.scan.pageLabel(n)}</span>
        {page.status === 'done' && page.reading?.mrz ? (
          <span className="flex items-center gap-1 text-sm text-success">
            <CircleCheck aria-hidden className="size-4" />
            {t.scan.codeLines}
          </span>
        ) : null}
        {unsure ? (
          <span className="flex items-center gap-1 text-sm text-warning">
            <TriangleAlert aria-hidden className="size-4" />
            {t.scan.checkCorners}
          </span>
        ) : null}
      </div>
      {src && page.status !== 'failed' ? (
        <img src={src} alt={t.scan.pageAlt(n)} className={`block w-full rounded-sm border border-border ${working ? 'opacity-50' : ''}`} />
      ) : null}
      {working ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t.scan.makingPage}
        </p>
      ) : null}
      {page.status === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          {t.scan.failed}
        </p>
      ) : null}
      {unsure ? <p className="text-sm text-muted-foreground">{t.scan.checkCornersHint}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => onTurn(false)} disabled={working}>
          <RotateCcw aria-hidden className="size-4" />
          {t.scan.turnLeft}
        </Button>
        <Button variant="outline" size="sm" onClick={() => onTurn(true)} disabled={working}>
          <RotateCw aria-hidden className="size-4" />
          {t.scan.turnRight}
        </Button>
        <Button variant="outline" size="sm" onClick={onAdjust} disabled={working || !page.corners}>
          <Crop aria-hidden className="size-4" />
          {t.scan.adjustCorners}
        </Button>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 aria-hidden className="size-4" />
          {t.scan.remove}
        </Button>
      </div>
    </li>
  )
}
