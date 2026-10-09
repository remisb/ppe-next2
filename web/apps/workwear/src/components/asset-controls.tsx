import type { Asset, ConnectionStatus } from '@ppe/api-client'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuNote,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ppe/ui/components/dropdown-menu'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { ChevronDown, Copy } from 'lucide-react'

import { t } from '@/i18n'
import { canMarkNotReturned, statusLabel, statusVariant } from '@/lib/assets'

const statuses: ConnectionStatus[] = ['NOT_ACTIVATED', 'ACTIVE', 'BLOCKED']

/** A SIM card's connection status as a badge. */
export function StatusBadge({ status }: { status: ConnectionStatus }) {
  return <Badge variant={statusVariant(status)}>{statusLabel(status)}</Badge>
}

/**
 * Change Status (§5): the three statuses in one menu on the same screen. The
 * choice is saved at once, with no confirmation; the note says it only
 * records what the provider confirmed, and a Not Activated card says how to
 * get it activated.
 */
export function StatusMenu({
  number,
  status,
  onChange,
  disabled = false,
}: {
  /** The card's inventory number, which names it for screen readers. */
  number: string
  status: ConnectionStatus
  onChange: (next: ConnectionStatus) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="sm" variant="outline" disabled={disabled} />}
        aria-label={`${t.assets.changeStatusOf(number)}: ${statusLabel(status)}`}
      >
        {t.assets.changeStatus}
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuNote>{t.assets.statusNote}</DropdownMenuNote>
        {status === 'NOT_ACTIVATED' ? <DropdownMenuNote className="text-foreground">{t.assets.activateNote}</DropdownMenuNote> : null}
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={status}
          onValueChange={(next: ConnectionStatus) => {
            if (next !== status) onChange(next)
          }}
        >
          {statuses.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {statusLabel(s)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A number with a button that copies it (§5: numbers are easy to copy, for
 * the e-mail to the provider). onCopied reports what happened, for the
 * screen's announcement.
 */
export function CopyNumber({ value, label, onCopied }: { value: string; label: string; onCopied: (ok: boolean) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs tabular-nums">{value}</span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={label}
        title={label}
        onClick={() => {
          // No clipboard outside a secure context (http on another host): say so instead.
          ;(navigator.clipboard?.writeText(value) ?? Promise.reject(new Error('no clipboard'))).then(
            () => onCopied(true),
            () => onCopied(false),
          )
        }}
      >
        <Copy aria-hidden />
      </Button>
    </span>
  )
}

/**
 * A card's less frequent actions under ⋯ (web/AGENTS.md: one everyday action
 * visible, the rest here). With `status` the three statuses are here too, for
 * a row whose visible action is another one.
 */
export function AssetMoreActions({
  asset,
  status = false,
  onStatus,
  onEdit,
  onNotReturned,
  onBlockingEmail,
}: {
  asset: Asset
  status?: boolean
  onStatus: (next: ConnectionStatus) => void
  onEdit: () => void
  onNotReturned: () => void
  onBlockingEmail: () => void
}) {
  const current = asset.connection_status
  return (
    <MoreActions label={t.common.moreActions(asset.inventory_no)}>
      {status && current ? (
        <>
          <DropdownMenuNote>{t.assets.changeStatus}</DropdownMenuNote>
          <DropdownMenuRadioGroup value={current} onValueChange={(next: ConnectionStatus) => next !== current && onStatus(next)}>
            {statuses.map((s) => (
              <DropdownMenuRadioItem key={s} value={s}>
                {statusLabel(s)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
        </>
      ) : null}
      <DropdownMenuItem onClick={onEdit}>{t.common.edit}</DropdownMenuItem>
      {canMarkNotReturned(asset) ? <DropdownMenuItem onClick={onNotReturned}>{t.assets.markNotReturned}</DropdownMenuItem> : null}
      {current && current !== 'BLOCKED' ? <DropdownMenuItem onClick={onBlockingEmail}>{t.assets.prepareBlockingEmail}</DropdownMenuItem> : null}
    </MoreActions>
  )
}
