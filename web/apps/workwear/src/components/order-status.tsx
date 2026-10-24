import type { OrderStatus } from '@ppe/api-client'
import { Badge } from '@ppe/ui/components/badge'
import { IssueBadge } from '@ppe/ui/components/issue-badge'

import { t } from '@/i18n'
import { LONG_WAIT_DAYS, statusLabel } from '@/lib/history'

/** An order's status: Ordered, still to confirm, or Given, done (green, as every finished state). */
export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string | undefined }) {
  return (
    <Badge variant={status === 'GIVEN' ? 'success' : 'secondary'} className={className}>
      {statusLabel[status]}
    </Badge>
  )
}

/**
 * How long an Ordered order has waited for its confirmation. Past
 * LONG_WAIT_DAYS it is a badge whose issue says what to do; before, plain words.
 */
export function OrderWait({ days }: { days: number }) {
  const text = days === 0 ? t.history.waitingToday : t.history.waitingFor(days)
  if (days > LONG_WAIT_DAYS) return <IssueBadge label={text} variant="destructive" issues={[t.history.longWait(LONG_WAIT_DAYS)]} />
  return <span className="text-sm text-muted-foreground">{text}</span>
}
