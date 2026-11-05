import { cn } from '@ppe/ui/lib/utils'

/** A picture's thumbnail as a line's lead, or an empty frame where there is none. */
export function Thumb({ src, alt, className }: { src: string | undefined; alt: string; className?: string | undefined }) {
  return src ? (
    <img src={src} alt={alt} className={cn('h-11 w-full rounded border border-border object-cover', className)} />
  ) : (
    <span aria-hidden className={cn('h-11 w-full rounded border border-dashed border-border', className)} />
  )
}
