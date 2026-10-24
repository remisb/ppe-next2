import { cva } from 'class-variance-authority'

/**
 * A text link's look, the same everywhere: underlined on hover (or always, for
 * a link inside running text that must read as one), a visible focus ring for
 * the keyboard, and a small radius so the ring sits snug. weight: medium for a
 * link that names a record or an action. Pass a layout's own classes as
 * className (min-h-11 on touch, inline-flex with an icon…). Buttons that read
 * as links use it too.
 */
export const linkVariants = cva('rounded-sm underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring', {
  variants: {
    underline: { hover: 'hover:underline', always: 'underline' },
    weight: { normal: '', medium: 'font-medium' },
  },
  defaultVariants: { underline: 'hover', weight: 'normal' },
})
