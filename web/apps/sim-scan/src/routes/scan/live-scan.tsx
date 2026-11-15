import { type ScanCard, simScanText } from '@ppe/sim-scan'
import { Button } from '@ppe/ui/components/button'
import { cn } from '@ppe/ui/lib/utils'

import { useLiveScan } from './use-live-scan'

/** The guide frame over the camera picture, as fractions of it: a card held across. */
const GUIDE = { x: 0.06, y: 0.22, w: 0.88, h: 0.56 }

/**
 * The camera inline, from 768px (a phone has PhoneCamera): card after card,
 * the reading itself in useLiveScan.
 */
export function LiveScan({
  known,
  onCard,
  onClose,
}: {
  known: string[]
  onCard: (card: ScanCard, front: Blob, back: Blob | null) => void
  onClose: () => void
}) {
  const t = simScanText()
  const scan = useLiveScan({ known, onCard, guide: GUIDE })

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] w-full max-w-xl overflow-hidden rounded-lg bg-black">
        <video ref={scan.video} className="size-full object-cover" playsInline muted />
        <div
          aria-hidden
          className={cn('pointer-events-none absolute rounded-md border-2', scan.justRead ? 'border-success' : scan.side === 'front' ? 'border-white' : 'border-warning')}
          style={{ left: `${GUIDE.x * 100}%`, top: `${GUIDE.y * 100}%`, width: `${GUIDE.w * 100}%`, height: `${GUIDE.h * 100}%` }}
        />
      </div>
      {scan.duplicateOf !== null ? (
        <p role="alert" className="text-sm font-medium text-warning">
          {t.notTakenAgain(scan.duplicateOf + 1)}
        </p>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm">
        {scan.problem ?? scan.status}
      </p>
      <div className="flex flex-wrap gap-2">
        {scan.side === 'back' ? (
          <Button variant="outline" onClick={scan.noBack}>
            {t.skipBack}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          {t.stopCamera}
        </Button>
      </div>
    </div>
  )
}
