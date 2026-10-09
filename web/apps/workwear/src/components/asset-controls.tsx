import type { ConnectionStatus } from '@ppe/api-client'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuNote,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ppe/ui/components/dropdown-menu'
import { ChevronDown, Copy } from 'lucide-react'

import { t } from '@/i18n'
import { statusLabel, statusVariant } from '@/lib/assets'

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
