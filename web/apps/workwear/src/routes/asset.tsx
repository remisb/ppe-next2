import type { AssetKind } from '@ppe/api-client'

import { AssetDetail } from '@/components/asset-detail'
import type { Route } from '@/lib/router'

/**
 * One asset on its own page (/assets/<id>), reached from an employee's page, ⌘K and
 * Equipment's rows; a SIM card's row opens it beside SIM Cards instead (/assets/sim-cards/<id>).
 */
export function AssetPage({ id, navigate, onBack }: { id: string; navigate: (to: Route) => void; onBack: (kind: AssetKind) => void }) {
  return <AssetDetail id={id} place={{ page: true, onBack }} navigate={navigate} onOpen={(other) => navigate({ name: 'asset', id: other })} />
}
