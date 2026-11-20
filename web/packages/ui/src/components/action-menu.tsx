import { Ellipsis } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'

import { type RecordAction, actionIcons, rowMenuGroups } from '../lib/record-actions.ts'
import { Button } from './button.tsx'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './dropdown-menu.tsx'

/** An action's icon from the vocabulary, as the bar, its ⋯ and a row's ⋯ draw it. */
export function ActionIcon({ action }: { action: RecordAction }) {
  if (!action.icon) return null
  const { icon: Icon, ...rest } = actionIcons[action.icon]
  return <Icon aria-hidden className={'className' in rest ? rest.className : undefined} />
}

/** Groups of actions as ⋯'s items, a separator between groups: red when destructive, disabled while busy or when it cannot be used. */
export function ActionMenuItems({ groups }: { groups: readonly (readonly RecordAction[])[] }) {
  return groups.map((group, i) => (
    <Fragment key={group[0]!.id}>
      {i > 0 ? <DropdownMenuSeparator /> : null}
      {group.map((a) => (
        <DropdownMenuItem
          key={a.id}
          data-action={a.id}
          variant={a.destructive ? 'destructive' : 'default'}
          disabled={a.pending || a.disabledReason !== undefined}
          onClick={a.run}
        >
          <ActionIcon action={a} />
          {a.label}
        </DropdownMenuItem>
      ))}
    </Fragment>
  ))
}

/**
 * A list row's ⋯, from the same model as the record's action bar
 * (docs/ux/record-actions.md), so a row and its record name, draw and order
 * their actions alike: every action an item, the main one first, what asks
 * first or is destructive last after a separator (rowMenuGroups). `shown`
 * names the actions the row already shows as buttons, left out here.
 * `children` come first, for a row's own controls the model does not hold
 * (the SIM register's statuses). Always visible, not revealed on hover: touch
 * screens have no hover. Nothing to list, no ⋯.
 */
export function RowActions({
  label,
  actions,
  shown,
  children,
  className,
}: {
  /** The accessible name: "More actions for …". */
  label: string
  actions: readonly RecordAction[]
  shown?: readonly string[] | undefined
  children?: ReactNode
  className?: string | undefined
}) {
  const groups = rowMenuGroups(actions, shown)
  if (groups.length === 0 && !children) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" className={className} />} aria-label={label}>
        <Ellipsis aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {children}
        {children && groups.length > 0 ? <DropdownMenuSeparator /> : null}
        <ActionMenuItems groups={groups} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
