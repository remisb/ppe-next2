import { Minus, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { cn } from '@/lib/utils'

/**
 * A quantity as − [n] +: the common change (one more, one fewer) is a tap,
 * with no keyboard; the number itself stays typeable for larger amounts, and
 * ↑ / ↓ step it from a keyboard. A
 * value that is not a whole number of at least 1 is kept and flagged, not
 * corrected, so what was typed is never lost.
 */
export function QuantityStepper({
  value,
  itemName,
  className,
  onChange,
}: {
  value: number
  itemName: string
  className?: string
  onChange: (quantity: number) => void
}) {
  const valid = Number.isInteger(value) && value >= 1
  // Button names avoid "quantity of", which the field's own label holds.
  return (
    <div className={cn('inline-flex items-stretch', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="rounded-r-none"
        aria-label={`One fewer ${itemName}`}
        disabled={!valid || value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus aria-hidden />
      </Button>
      <Input
        aria-label={`Quantity of ${itemName}`}
        inputMode="numeric"
        enterKeyHint="done"
        className="h-9 w-14 min-w-0 rounded-none border-x-0 px-1 text-center tabular-nums pointer-coarse:h-11"
        invalid={!valid}
        value={Number.isNaN(value) ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value.trim()
          onChange(raw === '' ? Number.NaN : Number(raw))
        }}
        // ↑ and ↓ step the quantity from the keyboard, as the buttons do.
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          if (e.key === 'ArrowUp') onChange(valid ? value + 1 : 1)
          else if (valid && value > 1) onChange(value - 1)
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className="rounded-l-none"
        aria-label={`One more ${itemName}`}
        onClick={() => onChange(valid ? value + 1 : 1)}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  )
}
