import { ExternalLink, MessageCircle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { whatsappUrl } from '@/lib/whatsapp'

/**
 * Copy for WhatsApp / Share via WhatsApp. Copies the text and offers to open
 * WhatsApp; it reports only that the text was copied, never that anything was
 * sent, and changes no order status.
 */
export function WhatsAppButton({ text, label = 'Copy for WhatsApp', disabled }: { text: string; label?: string; disabled?: boolean }) {
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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={disabled} onClick={() => void copy()}>
          <MessageCircle aria-hidden /> {label}
        </Button>
        {state !== 'idle' && !disabled ? (
          <a
            href={whatsappUrl(text)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            Open WhatsApp <ExternalLink aria-hidden className="size-3.5" />
          </a>
        ) : null}
      </div>
      {state === 'copied' && !disabled ? (
        <p role="status" className="text-sm text-muted-foreground">
          Copied to the clipboard. Paste it into WhatsApp.
        </p>
      ) : null}
      {state === 'manual' && !disabled ? (
        <Textarea aria-label="Order text for WhatsApp" readOnly rows={8} value={text} onFocus={(e) => e.target.select()} />
      ) : null}
    </div>
  )
}
