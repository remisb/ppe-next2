import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { type SortColumn, type SortState, nextSort } from '../lib/sort.ts'
import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'
import { Button } from './button.tsx'
import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './select.tsx'
import { TableHead } from './table.tsx'

export interface SortProps<K extends string> {
  sort: SortState<K> | null
  onSort: (next: SortState<K> | null) => void
  /** The list has a natural order to return to on a third click (catalogue display order, newest first). */
  allowNone?: boolean
}

/**
 * A column header that sorts its table. The header carries aria-sort; the
 * button inside is named by the column, so a screen reader hears "Name,
 * sorted ascending, button".
 */
export function SortableHead<K extends string>({
  column,
  sort,
  onSort,
  allowNone = false,
  align = 'left',
  className,
}: SortProps<K> & { column: SortColumn<K>; align?: 'left' | 'right'; className?: string | undefined }) {
  const active = sort?.key === column.key ? sort.dir : null
  const Icon = active === 'asc' ? ArrowUp : active === 'desc' ? ArrowDown : ArrowUpDown
  const right = align === 'right'
  return (
    <TableHead aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'} className={cn(right && 'text-right', className)}>
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, column, allowNone))}
        className={cn(
          // min-h-8, not h-8: a header allowed to wrap (whitespace-normal) grows to its lines.
          'group -mx-1.5 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
          right && 'flex-row-reverse',
        )}
      >
        {column.label}
        <Icon
          aria-hidden
          className={cn('size-3.5 shrink-0', active ? 'text-foreground' : 'text-muted-foreground/50 group-hover:text-muted-foreground')}
        />
      </button>
    </TableHead>
  )
}

/**
 * The same sort for a stacked table, whose header row is hidden: pass it as
 * the Table's `sortControl`, which shows only while the table is stacked.
 */
export function SortControl<K extends string>({
  columns,
  sort,
  onSort,
  allowNone = false,
  noneLabel,
}: SortProps<K> & { columns: readonly SortColumn<K>[]; noneLabel?: string }) {
  const dir = sort?.dir ?? 'asc'
  // The choices, also the labels the field shows for its value ('' is the list's own order).
  const items = [...(allowNone ? [{ value: '', label: noneLabel ?? uiText().defaultOrder }] : []), ...columns.map((c) => ({ value: c.key as string, label: c.label }))]
  // On a phone the label is inside the field, and the order is said in words: "Sort by: Date, newest first".
  const column = columns.find((c) => c.key === sort?.key)
  const words = column?.kind && sort ? uiText().sortWords[column.kind][sort.dir] : null
  const shown = (
    <>
      <span className="text-muted-foreground md:hidden">{uiText().sortByPrefix} </span>
      {column?.label ?? items[0]?.label}
      {words ? <span className="md:hidden">, {words}</span> : null}
    </>
  )
  return (
    <div className="flex items-end gap-2">
      {/* shadcn's Select, in the Orders Date filter's look: its list opens over the field. */}
      <Select
        items={items}
        value={sort?.key ?? ''}
        onValueChange={(v) => {
          const column = columns.find((c) => c.key === v)
          onSort(column ? { key: column.key, dir: column.firstDir ?? 'asc' } : null)
        }}
      >
        <div className="min-w-0 flex-1">
          {/* Its name still: shown above from md, inside the field on a phone. */}
          <SelectLabel className="max-md:sr-only">{uiText().sortBy}</SelectLabel>
          <SelectTrigger className="md:mt-1.5">
            <SelectValue>{shown}</SelectValue>
          </SelectTrigger>
        </div>
        <SelectContent head={shown}>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        disabled={!sort}
        aria-label={dir === 'asc' ? uiText().ascending : uiText().descending}
        onClick={() => sort && onSort({ key: sort.key, dir: dir === 'asc' ? 'desc' : 'asc' })}
      >
        {dir === 'asc' ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
      </Button>
    </div>
  )
}
