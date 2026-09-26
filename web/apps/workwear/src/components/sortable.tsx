import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { TableHead } from '@/components/ui/table'
import { type SortColumn, type SortState, nextSort } from '@/lib/sort'
import { cn } from '@/lib/utils'

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
          'group -mx-1.5 inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
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
  noneLabel = 'Default order',
}: SortProps<K> & { columns: readonly SortColumn<K>[]; noneLabel?: string }) {
  const dir = sort?.dir ?? 'asc'
  const id = useId()
  // A separate label (htmlFor), not one wrapping the select: a wrapping label's
  // text would include every option ("Sort by Record Employee Status …").
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-sm font-medium">
          Sort by
        </label>
        <Select
          id={id}
          className="mt-1.5"
          value={sort?.key ?? ''}
          onChange={(e) => {
            const column = columns.find((c) => c.key === e.target.value)
            onSort(column ? { key: column.key, dir: column.firstDir ?? 'asc' } : null)
          }}
        >
          {allowNone ? <option value="">{noneLabel}</option> : null}
          {columns.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        disabled={!sort}
        aria-label={dir === 'asc' ? 'Ascending; switch to descending' : 'Descending; switch to ascending'}
        onClick={() => sort && onSort({ key: sort.key, dir: dir === 'asc' ? 'desc' : 'asc' })}
      >
        {dir === 'asc' ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
      </Button>
    </div>
  )
}
