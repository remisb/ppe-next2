import { capitalize, formatDateTime, formatRelative } from '@/lib/history'

/**
 * A date in a list as people say it ("3 days ago", "Today 14:03", "22 Sept"),
 * with the exact date and time in the organisation's timezone on hover. Lists
 * only: records and receipts keep absolute dates.
 */
export function RelativeDate({
  iso,
  timeZone,
  time = false,
  sentence = false,
  className,
}: {
  iso: string
  timeZone: string | undefined
  /** Today's and yesterday's with the time of day. */
  time?: boolean
  /** Inside a sentence ("given 3 days ago"): lower case. */
  sentence?: boolean
  className?: string
}) {
  const text = formatRelative(iso, new Date(), timeZone, { time })
  return (
    <time dateTime={iso} title={formatDateTime(iso, timeZone)} className={className}>
      {sentence ? text : capitalize(text)}
    </time>
  )
}
