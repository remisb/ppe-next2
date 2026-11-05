import { Copy } from 'lucide-react'

import { Button } from './button.tsx'

/**
 * A button copying text: a SIM's two numbers as one line, an error's
 * reference. label is its name and tooltip; onCopied reports what happened,
 * for the screen's announcement ("Copied." or why not).
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
