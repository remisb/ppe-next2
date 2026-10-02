import type { SupplierChat } from '@ppe/api-client'
import { Check, ExternalLink, MessageCircle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'
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
}: {
  text: string
  /** Defaults to Copy for WhatsApp. */
  label?: string | undefined
  disabled?: boolean | undefined
  /** Sizes the button, e.g. full width in a phone action bar. */
  className?: string | undefined
  /** The group to open: the supplier's, for an order message; none for anything else. */
  chat?: SupplierChat | null | undefined
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('manual') // clipboard blocked: show the text to copy by hand
    }
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Button variant="outline" className="w-full" disabled={disabled} onClick={() => void copy()}>
        {state === 'copied' && !disabled ? <Check aria-hidden /> : <MessageCircle aria-hidden />}
        <span className="truncate">{label ?? t.order.copyForWhatsApp}</span>
      </Button>
      {state === 'copied' && !disabled && chat ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t.order.copied}{' '}
          <ChatLink chat={chat} />
          {t.order.pasteThere}
        </p>
      ) : state === 'copied' && !disabled ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t.order.copied}{' '}
          <a href={whatsappUrl(text)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-4">
            {t.order.openWhatsApp} <ExternalLink aria-hidden className="size-3" />
          </a>
        </p>
      ) : null}
      {state === 'manual' && !disabled ? (
        <>
          {chat ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t.order.copyBlockedChat} <ChatLink chat={chat} />
              {t.order.pasteThere}
            </p>
          ) : (
          <p role="status" className="text-xs text-muted-foreground">
            {t.order.copyBlockedBefore}
            <a href={whatsappUrl(text)} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4">
              {t.order.copyBlockedLink}
            </a>
            {t.order.copyBlockedAfter}
          </p>
          )}
          <Textarea aria-label={t.order.whatsappText} readOnly rows={6} value={text} onFocus={(e) => e.target.select()} />
        </>
      ) : null}
    </div>
  )
}

/** Opens the group by its invite link: WhatsApp on a phone, WhatsApp Web or the app on a computer. */
function ChatLink({ chat }: { chat: SupplierChat }) {
  return (
    <a href={chat.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-4">
      {t.order.openChat(chat.name)} <ExternalLink aria-hidden className="size-3" />
    </a>
  )
}
