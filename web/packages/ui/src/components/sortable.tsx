import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'

import { type SortColumn, type SortDir, type SortState, nextSort } from '../lib/sort.ts'
import { cn } from '../lib/utils.ts'
import { uiText } from '../text.ts'
import {
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from './dropdown-menu.tsx'
import { MenuButton } from './page-header.tsx'
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
 * The words a stacked list's Sort ▾ shows for an order: the column and, where
 * its values have a kind, the direction in words ("Date, newest first");
 * the list's own order by its name.
 */
export function sortLabel<K extends string>(columns: readonly SortColumn<K>[], sort: SortState<K> | null, noneLabel?: string): string {
  const column = columns.find((c) => c.key === sort?.key)
  if (!column || !sort) return noneLabel ?? uiText().defaultOrder
  return column.kind ? `${column.label}, ${uiText().sortWords[column.kind][sort.dir]}` : column.label
}

/**
 * Sort ▾, the same sort for a stacked table, whose header row is hidden: a
 * menu button that says the order, whose menu has the columns, then the two
 * directions in words. Pass it as the Table's `sortControl`, which shows only
 * while the table is stacked, standing where its heads would be.
 */
export function SortMenu<K extends string>({
  columns,
  sort,
  onSort,
  allowNone = false,
  noneLabel,
}: SortProps<K> & { columns: readonly SortColumn<K>[]; noneLabel?: string }) {
  const text = uiText()
  const column = columns.find((c) => c.key === sort?.key)
  const label = sortLabel(columns, sort, noneLabel)
  const Icon = !sort ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <div className="flex justify-end">
      <MenuButton icon={Icon} label={label} aria-label={`${text.sortBy}: ${label}`}>
        <DropdownMenuGroup>
          <DropdownMenuGroupLabel>{text.sortBy}</DropdownMenuGroupLabel>
          <DropdownMenuRadioGroup
            value={sort?.key ?? ''}
            onValueChange={(v: string) => {
              const next = columns.find((c) => c.key === v)
              onSort(next ? { key: next.key, dir: next.firstDir ?? 'asc' } : null)
            }}
          >
            {allowNone ? <DropdownMenuRadioItem value="">{noneLabel ?? text.defaultOrder}</DropdownMenuRadioItem> : null}
            {columns.map((c) => (
              <DropdownMenuRadioItem key={c.key} value={c.key}>
                {c.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {sort ? (
          <>
            <DropdownMenuSeparator />
            {/* The directions in the column's words: A–Z, newest first, smallest first. */}
            <DropdownMenuRadioGroup value={sort.dir} onValueChange={(dir: SortDir) => onSort({ key: sort.key, dir })}>
              {(['asc', 'desc'] as const).map((dir) => (
                <DropdownMenuRadioItem key={dir} value={dir}>
                  {column?.kind ? text.sortWords[column.kind][dir] : dir === 'asc' ? text.sortAsc : text.sortDesc}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        ) : null}
      </MenuButton>
    </div>
  )
}
