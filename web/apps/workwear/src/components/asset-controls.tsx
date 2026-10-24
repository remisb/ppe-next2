import type { Asset, ConnectionStatus } from '@ppe/api-client'
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
import { IssueBadge } from '@ppe/ui/components/issue-badge'
import { HelpTooltip } from '@ppe/ui/components/tooltip'
import { ChevronDown, Copy } from 'lucide-react'
import type { ComponentProps } from 'react'

import { t } from '@/i18n'
import { canMarkNotReturned, statusLabel, statusVariant } from '@/lib/assets'

const statuses: ConnectionStatus[] = ['NOT_ACTIVATED', 'ACTIVE', 'BLOCKED']

/**
 * A SIM card's connection status as a badge. Not Activated and Blocked say why
 * the card cannot be given and what to do (IssueBadge); opens on a page or a
 * pane, a tooltip in the register's rows.
 */
export function StatusBadge({ status, opens = false }: { status: ConnectionStatus; opens?: boolean }) {
  const issues = status === 'ACTIVE' ? [] : [t.assets.statusIssue[status]]
  return <IssueBadge label={statusLabel(status)} variant={statusVariant(status)} issues={issues} opens={opens} />
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
 * Return: one short word for a SIM and an item, so it
 * fits beside the card's numbers; what it does is its help tooltip, on hover and
 * to screen readers.
 */
export function ReturnButton({
  kind,
  onClick,
  ...props
}: { kind: Asset['kind']; onClick: () => void } & Pick<ComponentProps<typeof Button>, 'size' | 'variant'>) {
  return (
    <HelpTooltip title={t.assets.takeBack} help={t.assets.takeBackHelp[kind === 'EQUIPMENT' ? 'EQUIPMENT' : 'SIM']}>
      <Button {...props} onClick={onClick}>
        {t.assets.takeBack}
      </Button>
    </HelpTooltip>
  )
}

/**
 * A button copying text (§5: numbers are easy to copy, for the e-mail to the
 * provider): a SIM's two numbers as one line (simCopyText). label is its name
 * and tooltip; onCopied reports what happened, for the screen's announcement.
 */
export function CopyButton({ text, label, onCopied }: { text: string; label: string; onCopied: (ok: boolean) => void }) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={() => {
        // No clipboard outside a secure context (http on another host): say so instead.
        ;(navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'))).then(
          () => onCopied(true),
          () => onCopied(false),
        )
      }}
    >
      <Copy aria-hidden />
    </Button>
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
