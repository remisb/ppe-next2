import { currentLang } from '@ppe/i18n'
import { enGB, lt, ru } from 'react-day-picker/locale'

import { Calendar } from './calendar.tsx'

/** The calendar's month and weekday names and first day of the week (Monday in all three). */
const dayPickerLocales = { en: enGB, lt, ru }

/**
 * DateInput's calendar: one day to pick, in the language in use, with month
 * and year lists, the days outside first and last not offered. Its own module,
 * loaded when a calendar is first opened, so React DayPicker and its date
 * library are not in every page's first load.
 */
export default function DateCalendar({
  selected,
  month,
  first,
  last,
  onSelect,
}: {
  selected: Date | undefined
  /** The month it opens on. */
  month: Date
  first: Date | undefined
  last: Date | undefined
  onSelect: (day: Date) => void
}) {
  return (
    <Calendar
      mode="single"
      required
      autoFocus
      locale={dayPickerLocales[currentLang()]}
      // The month list's names: short ("Oct", "окт."), but Lithuanian's short form is a number ("10"), so its long one ("spalis").
      formatters={{ formatMonthDropdown: (d) => d.toLocaleString(dayPickerLocales[currentLang()].code, { month: currentLang() === 'lt' ? 'long' : 'short' }) }}
      captionLayout="dropdown"
      selected={selected}
      defaultMonth={month}
      startMonth={first ?? new Date(new Date().getFullYear() - 10, 0)}
      endMonth={last ?? new Date(new Date().getFullYear() + 5, 11)}
      disabled={[...(first ? [{ before: first }] : []), ...(last ? [{ after: last }] : [])]}
      onSelect={onSelect}
      // A day is 36px, 44px on a touch screen.
      className="[--cell-size:--spacing(9)] pointer-coarse:[--cell-size:--spacing(11)]"
    />
  )
}
