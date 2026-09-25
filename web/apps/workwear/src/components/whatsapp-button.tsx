import { Check, ExternalLink, MessageCircle } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/field'
import { cn } from '@/lib/utils'
import { whatsappUrl } from '@/lib/whatsapp'

/**
 * Copy for WhatsApp / Share via WhatsApp. Copies the text and offers to open
 * WhatsApp; it reports only that the text was copied, never that anything was
 * sent, and changes no order status.
 */
export function WhatsAppButton({
  text,
  label = 'Copy for WhatsApp',
  disabled,
  className,
}: {
  text: string
  label?: string
  disabled?: boolean | undefined
  /** Sizes the button, e.g. full width in a phone action bar. */
  className?: string | undefined
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
        <span className="truncate">{label}</span>
      </Button>
      {state === 'copied' && !disabled ? (
        <p role="status" className="text-xs text-muted-foreground">
          Copied.{' '}
          <a href={whatsappUrl(text)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline underline-offset-4">
            Open WhatsApp <ExternalLink aria-hidden className="size-3" />
          </a>
        </p>
      ) : null}
      {state === 'manual' && !disabled ? (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            Copying is blocked here. Select the text below, or{' '}
            <a href={whatsappUrl(text)} target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4">
              open WhatsApp
            </a>
            .
          </p>
          <Textarea aria-label="Order text for WhatsApp" readOnly rows={6} value={text} onFocus={(e) => e.target.select()} />
        </>
      ) : null}
    </div>
  )
}
