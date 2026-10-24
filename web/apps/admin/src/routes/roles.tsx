import type { Permission, PermissionInfo, Role } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { Field, Input, Textarea, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { ActionError, EmptyState, Loaded, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { useAction } from '@ppe/ui/lib/use-action'
import { combineLoads, errorText, useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { Lock, Plus } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'

import { t } from '@/i18n'
import { type RoleDraft, type RoleErrors, draftOf, grouped, neededBy, permissionLabel, togglePermission, validateRole } from '@/lib/roles'
import { roleGrants, roleName } from '@/lib/users'

/**
 * Roles & permissions: each role and what it allows. Whoever manages roles
 * adds, changes and deletes them; Administrator stays as it is, and a role
 * someone holds is not deleted. Roles are given to users on Users.
 */
export function RolesPage() {
  const { client } = useApi()
  const session = useSession()
  const allowed = session.can('roles.manage')
  const roles = useLoad(() => (allowed ? client.roles.list() : Promise.resolve([])))
  const catalogue = useLoad(() => (allowed ? client.permissions() : Promise.resolve([])))
  const [editing, setEditing] = useState<Role | 'new' | null>(null)
  const action = useAction()

  if (!allowed) {
    return (
      <>
        <PageHeader title={t.roles.title} />
        <EmptyState>{t.roles.onlyRoleManagers}</EmptyState>
      </>
    )
  }

  const remove = (r: Role) =>
    action.run(
      async () => {
        await client.roles.remove(r.id)
        roles.reload()
      },
      { confirm: t.roles.deleteQuestion(r.name), mapError: (err) => (err instanceof ApiError && err.isConflict ? new Error(t.roles.inUse) : err) },
    )

  return (
    <>
      <PageHeader
        title={t.roles.title}
        description={t.roles.description}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t.roles.addRole}
          </Button>
        }
      />
      <ActionError error={action.error} className="mb-4" />
      <Loaded load={combineLoads(roles, catalogue)}>
        {([list]) => (
          // Where the table is narrow the roles are one list of rows: name and what it is for, then its counts, with Edit and ⋯ beside them.
          <Table stack="list">
            <TableHeader>
              <TableRow>
                <TableHead>{t.roles.name}</TableHead>
                <TableHead>{t.roles.permissions}</TableHead>
                <TableHead>{t.roles.users}</TableHead>
                <TableHead className="text-right">{t.roles.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.id} className="stacked:grid stacked:grid-cols-[minmax(0,1fr)_auto] stacked:gap-x-3">
                  <TableCell className="whitespace-normal stacked:col-start-1 stacked:row-start-1">
                    <span className="font-medium">{roleName(r)}</span>
                    {r.key ? (
                      <Badge variant="outline" className="ml-2 align-middle">
                        {r.locked ? <Lock aria-hidden /> : null}
                        {t.roles.builtIn}
                      </Badge>
                    ) : null}
                    {roleGrants(r) ? <span className="block text-xs text-muted-foreground">{roleGrants(r)}</span> : null}
                  </TableCell>
                  <TableCell className="whitespace-normal stacked:col-start-1 stacked:row-start-2 stacked:text-xs stacked:text-muted-foreground">
                    <span className="stacked:hidden">{r.permissions.map(permissionLabel).join(', ') || '–'}</span>
                    <span className="hidden stacked:inline">{t.roles.permissionsCount(r.permissions.length)}</span>
                  </TableCell>
                  <TableCell className="tabular-nums stacked:col-start-1 stacked:row-start-3 stacked:text-xs stacked:text-muted-foreground">
                    {t.roles.usersCount(r.user_count)}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap stacked:col-start-2 stacked:flex stacked:[grid-row:1/span_3] stacked:items-center stacked:gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(r)}
                      aria-label={r.locked ? t.roles.viewRoleLabel(roleName(r)) : t.roles.editRoleLabel(roleName(r))}
                    >
                      {r.locked ? t.common.view : t.common.edit}
                    </Button>
                    {r.key ? null : (
                      <>
                        {' '}
                        <MoreActions label={t.common.moreActions(r.name)}>
                          <DropdownMenuItem variant="destructive" onClick={() => void remove(r)}>
                            {t.roles.deleteRole}
                          </DropdownMenuItem>
                        </MoreActions>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Loaded>
      <RoleForm
        open={editing !== null}
        role={editing === 'new' || editing === null ? undefined : editing}
        catalogue={catalogue.data ?? []}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          roles.reload()
        }}
      />
    </>
  )
}

/** Add Role, Edit Role, or Administrator shown as it is (it cannot change). A built-in role's name and description are fixed, shown in the language in use. */
function RoleForm({
  open,
  role,
  catalogue,
  onClose,
  onSaved,
}: {
  open: boolean
  role: Role | undefined
  catalogue: readonly PermissionInfo[]
  onClose: () => void
  onSaved: () => void
}) {
  const { client } = useApi()
  const [d, setD] = useState<RoleDraft>(() => draftOf(role))
  const [errors, setErrors] = useState<RoleErrors>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const locked = role?.locked ?? false
  const builtIn = role?.key != null

  useEffect(() => {
    if (open) {
      setD(draftOf(role))
      setErrors({})
      setServerError(undefined)
    }
  }, [open, role])

  const toggle = (p: Permission, on: boolean) => setD((cur) => ({ ...cur, permissions: togglePermission(cur.permissions, p, on, catalogue) }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = validateRole(d)
    setErrors(v)
    setServerError(undefined)
    if (Object.keys(v).length > 0) return
    // Ask first before taking a permission away from people who hold the role.
    const removed = role ? role.permissions.filter((p) => !d.permissions.includes(p)).length : 0
    if (role && removed > 0 && role.user_count > 0 && !window.confirm(t.roles.confirmRemovePermissions(removed, role.user_count))) return
    setBusy(true)
    try {
      const input = { name: d.name.trim(), description: d.description.trim(), permissions: d.permissions }
      if (role) await client.roles.update(role.id, input)
      else await client.roles.create(input)
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) setErrors({ name: t.roles.nameTaken })
      else setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const title = !role ? t.roles.addRole : locked ? t.roles.viewRole(roleName(role)) : t.roles.editRole(roleName(role))
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={title}
      description={locked ? t.roles.lockedNote : role ? t.roles.editDescription(role.user_count) : t.roles.addDescription}
      footer={
        locked ? (
          <Button variant="outline" onClick={onClose}>
            {t.common.close}
          </Button>
        ) : (
          <FormSheetActions form="role-form" onCancel={onClose} busy={busy} submitLabel={role ? undefined : t.roles.addRole} />
        )
      }
    >
      <form id="role-form" onSubmit={submit} className="grid gap-4" noValidate>
        <Field label={t.roles.name} required error={errors.name}>
          {(p) => (
            <Input
              {...controlProps(p)}
              autoComplete="off"
              value={builtIn && role ? roleName(role) : d.name}
              disabled={builtIn}
              onChange={(e) => setD((cur) => ({ ...cur, name: e.target.value }))}
              autoFocus={!builtIn}
            />
          )}
        </Field>
        <Field label={t.roles.descriptionLabel} error={errors.description} hint={builtIn ? t.roles.builtInFixed : undefined}>
          {(p) => (
            <Textarea
              {...controlProps(p)}
              rows={2}
              value={builtIn && role ? roleGrants(role) : d.description}
              disabled={builtIn}
              onChange={(e) => setD((cur) => ({ ...cur, description: e.target.value }))}
            />
          )}
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t.roles.permissions}</legend>
          <div className="grid gap-4">
            {grouped(catalogue).map(({ group, permissions }) => (
              <div key={group} role="group" aria-label={t.roles.groups[group]}>
                <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{t.roles.groups[group]}</p>
                <div className="grid gap-1">
                  {permissions.map(({ key }) => {
                    const needers = neededBy(key, d.permissions, catalogue)
                    const fixed = locked || needers.length > 0
                    return (
                      <label key={key} className={cn('flex min-h-11 items-start gap-3 rounded-md py-2 text-sm', fixed && 'opacity-70')}>
                        <input
                          type="checkbox"
                          className="mt-0.5 size-5 shrink-0 accent-primary"
                          checked={d.permissions.includes(key)}
                          disabled={fixed}
                          onChange={(e) => toggle(key, e.target.checked)}
                        />
                        <span>
                          <span className="font-medium">{permissionLabel(key)}</span>
                          <span className="block text-muted-foreground">
                            {t.roles.permission[key].grants}
                            {!locked && needers.length > 0 ? ` ${t.roles.neededBy(needers.map(permissionLabel).join(', '))}` : ''}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
        {serverError ? (
          <p role="alert" className="text-sm text-destructive">
            {serverError}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}
