import type { CatalogueItem } from '@ppe/api-client'
import { IssueBadge } from '@ppe/ui/components/issue-badge'

import { t } from '@/i18n'
import { incompleteReasons } from '@/lib/records'

type Prices = Pick<CatalogueItem, 'accounting_price_cents' | 'service_period_months'>

/**
 * An item's Incomplete badge: "Incomplete", or "Incomplete (2)", listing each
 * missing value and what that means for ordering (IssueBadge). opens for the
 * item pane; a tooltip in the list. Nothing for a complete item.
 */
export function IncompleteBadge({ item, opens = false, className }: { item: Prices; opens?: boolean; className?: string }) {
  const issues = incompleteReasons(item)
  if (issues.length === 0) return null
  return <IssueBadge label={t.catalogue.incomplete} variant="warning" issues={issues} note={t.catalogue.incompleteNote} opens={opens} className={className} />
}

/** An inactive item's badge, saying what being inactive means (IssueBadge). */
export function InactiveItemBadge({ opens = false }: { opens?: boolean }) {
  return <IssueBadge label={t.catalogue.inactive} variant="outline" issues={[t.catalogue.inactiveIssue]} opens={opens} />
}

/** An inactive item set's badge, saying what being inactive means (IssueBadge). */
export function InactiveSetBadge({ opens = false }: { opens?: boolean }) {
  return <IssueBadge label={t.common.inactive} variant="outline" issues={[t.catalogue.setInactiveIssue]} opens={opens} />
}
