import type { SupplierChat } from '@ppe/api-client'
import { Button } from '@ppe/ui/components/button'
import { Textarea } from '@ppe/ui/components/field'
import { cn } from '@ppe/ui/lib/utils'
import { linkVariants } from '@ppe/ui/components/link'
import { Check, ExternalLink, MessageCircle } from 'lucide-react'
import { useState } from 'react'

import { t } from '@/i18n'
import { whatsappUrl } from '@/lib/whatsapp'

/**
 * Copy for WhatsApp / Share via WhatsApp. Copies the text and offers to open
 * WhatsApp; it reports only that the text was copied, never that anything was
 * sent, and changes no order status. With a chat (the supplier's group, set on
 * Settings) it opens that group for the user to paste into, since WhatsApp
 * cannot open a group with the text typed in; without one, WhatsApp opens with
 * the text and the user picks the chat.
 */
export function WhatsAppButton({
  text,
  label,
  disabled,
  className,
  chat,
  quiet,
}: {
  text: string
  /** Defaults to Copy for WhatsApp. */
  label?: string | undefined
  disabled?: boolean | undefined
  /** Sizes the button, e.g. full width in a phone action bar. */
  className?: string | undefined
  /** The group to open: the supplier's, for an order message; none for anything else. */
  chat?: SupplierChat | null | undefined
  /** Nothing under the button once copied (Create Order's review): its tick says so; blocked copying still shows the text. */
  quiet?: boolean | undefined
}) {
  const { state, copy } = useWhatsAppCopy(text)

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Button variant="outline" className="w-full" disabled={disabled} onClick={() => void copy()}>
        {/* WhatsApp's green, copied or not. */}
        {state === 'copied' && !disabled ? <Check aria-hidden className="text-whatsapp" /> : <MessageCircle aria-hidden className="text-whatsapp" />}
        <span className="truncate">{label ?? t.order.copyForWhatsApp}</span>
      </Button>
      {disabled || (quiet && state === 'copied') ? null : <WhatsAppCopyStatus state={state} text={text} chat={chat} />}
    </div>
  )
}

export type WhatsAppCopyState = 'idle' | 'copied' | 'manual'

/** Copies text for WhatsApp; 'manual' when the clipboard is blocked, so the text is shown to copy by hand. */
export function useWhatsAppCopy(text: string) {
  const [state, setState] = useState<WhatsAppCopyState>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('manual') // clipboard blocked: show the text to copy by hand
    }
  }
  return { state, copy }
}

/**
 * What a copy for WhatsApp says once done: Copied with the group (or WhatsApp)
 * to open, or, when copying was blocked, the text to select. Nothing while idle.
 * Also under the order's ⋯, whose menu closes on the copy.
 */
export function WhatsAppCopyStatus({ state, text, chat }: { state: WhatsAppCopyState; text: string; chat?: SupplierChat | null | undefined }) {
  if (state === 'copied') {
    return chat ? (
      <p role="status" className="text-xs text-muted-foreground">
        {t.order.copied}{' '}
        <ChatLink chat={chat} />
        {t.order.pasteThere}
      </p>
    ) : (
      <p role="status" className="text-xs text-muted-foreground">
        {t.order.copied}{' '}
        <a href={whatsappUrl(text)} target="_blank" rel="noreferrer" className={linkVariants({ underline: 'always', weight: 'medium', className: 'inline-flex items-center gap-0.5 text-foreground' })}>
          {t.order.openWhatsApp} <ExternalLink aria-hidden className="size-3" />
        </a>
      </p>
    )
  }
  if (state !== 'manual') return null
  return (
    <>
      {chat ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t.order.copyBlockedChat} <ChatLink chat={chat} />
          {t.order.pasteThere}
        </p>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {t.order.copyBlockedBefore}
          <a href={whatsappUrl(text)} target="_blank" rel="noreferrer" className={linkVariants({ underline: 'always', weight: 'medium', className: 'text-foreground' })}>
            {t.order.copyBlockedLink}
          </a>
          {t.order.copyBlockedAfter}
        </p>
      )}
      <Textarea aria-label={t.order.whatsappText} readOnly rows={6} value={text} onFocus={(e) => e.target.select()} />
    </>
  )
}

/** Opens the group by its invite link: WhatsApp on a phone, WhatsApp Web or the app on a computer. */
function ChatLink({ chat }: { chat: SupplierChat }) {
  return (
    <a href={chat.link} target="_blank" rel="noreferrer" className={linkVariants({ underline: 'always', weight: 'medium', className: 'inline-flex items-center gap-0.5 text-foreground' })}>
      {t.order.openChat(chat.name)} <ExternalLink aria-hidden className="size-3" />
    </a>
  )
}
