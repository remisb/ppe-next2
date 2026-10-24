import type { CatalogueItem } from '@ppe/api-client'
import { IssueBadge } from '@ppe/ui/components/issue-badge'

import { t } from '@/i18n'
import { incompleteReasons } from '@/lib/records'

/*
 * The catalogue's status badges, each listing what its state means or what to
 * fix (IssueBadge: a button on a page or pane, a tooltip in a list's row).
 */

/** "Incomplete", or "Incomplete (2)": each missing value and what that means for ordering. Nothing for a complete item. */
export function IncompleteBadge({ item }: { item: Pick<CatalogueItem, 'accounting_price_cents' | 'service_period_months'> }) {
  const issues = incompleteReasons(item)
  if (issues.length === 0) return null
  return <IssueBadge label={t.catalogue.incomplete} variant="warning" issues={issues} note={t.catalogue.incompleteNote} />
}

/** An inactive item's badge, saying what being inactive means. */
export function InactiveItemBadge() {
  return <IssueBadge label={t.catalogue.inactive} variant="outline" issues={[t.catalogue.inactiveIssue]} />
}

/** An inactive item set's badge, saying what being inactive means. */
export function InactiveSetBadge() {
  return <IssueBadge label={t.common.inactive} variant="outline" issues={[t.catalogue.setInactiveIssue]} />
}
