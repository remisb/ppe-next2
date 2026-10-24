import type { Role, User } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { MIN_PASSWORD_LENGTH, useApi, useSession } from '@ppe/app-shell'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { Field, Input, PasswordInput, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { SortControl, SortableHead } from '@ppe/ui/components/sortable'
import { EmptyState, Loaded, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { type SortColumn, type SortState, sortRows } from '@ppe/ui/lib/sort'
import { combineLoads, errorText, useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { Plus } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { t } from '@/i18n'
import type { Route } from '@/lib/router'
import { type UserDraft, type UserErrors, draftOf, ownAccountLocks, roleGrants, roleName, roleRank, rolesOf, validateNewPassword, validateUser } from '@/lib/users'

type UserSort = 'name' | 'email' | 'roles' | 'status'

const columns = (): SortColumn<UserSort>[] => [
  { key: 'name', label: t.users.name, kind: 'text' },
  { key: 'email', label: t.users.email, kind: 'text' },
  { key: 'roles', label: t.users.roles, kind: 'text' },
  { key: 'status', label: t.users.status },
]

/**
 * Users: the accounts that sign in to the apps, and the roles each holds.
 * For whoever manages users; the navigation shows it to them alone, and the
 * API refuses everyone else.
 */
export function UsersPage({ navigate }: { navigate: (to: Route) => void }) {
  const { client } = useApi()
  const session = useSession()
  const allowed = session.can('users.manage')
  const users = useLoad(() => (allowed ? client.users.list() : Promise.resolve([])))
  const roleList = useLoad(() => (allowed ? client.roles.list() : Promise.resolve([])))
  const allRoles = roleList.data ?? []
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<User | 'new' | null>(null)
  // What the last save did, as a status line (a screen reader hears it too).
  const [saved, setSaved] = useState('')
  const [resetting, setResetting] = useState<User | null>(null)

  const [sort, setSort] = useState<SortState<UserSort> | null>({ key: 'name', dir: 'asc' })
  const sortProps = { sort, onSort: setSort }

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const matching = (users.data ?? []).filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q))
    return sortRows(matching, sort, (u, key) => {
      switch (key) {
        case 'name':
          return u.name
        case 'email':
          return u.email
        case 'roles':
          return roleRank(u, allRoles)
        case 'status':
          return u.is_active ? 0 : 1
      }
    })
  }, [users.data, roleList.data, filter, sort])

  if (!allowed) {
    return (
      <>
        <PageHeader title={t.users.title} />
        <EmptyState>{t.users.onlyAdmins}</EmptyState>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={t.users.title}
        description={t.users.description}
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> {t.users.addUser}
          </Button>
        }
      />
      <div className="mb-4 md:max-w-sm">
        <Input
          type="search"
          enterKeyHint="search"
          placeholder={t.users.searchPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={t.users.searchLabel}
          data-shortcut="search"
        />
      </div>
      <p role="status" className="mb-3 text-sm text-muted-foreground empty:hidden">
        {saved}
      </p>
      <Loaded load={combineLoads(users, roleList)} empty={shown.length === 0} emptyState={filter ? t.users.noMatch(filter.trim()) : t.users.noUsers}>
        {() => (
          // Where the table is narrow the users are one list of rows: name, email, then roles, with Edit and ⋯ beside them.
          <Table stack="list" sortControl={<SortControl columns={columns()} {...sortProps} />}>
            <TableHeader>
              <TableRow>
                {columns().map((c) => (
                  <SortableHead key={c.key} column={c} {...sortProps} />
                ))}
                <TableHead className="text-right">{t.users.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((u) => (
                <TableRow key={u.id} className={cn('stacked:grid stacked:grid-cols-[minmax(0,1fr)_auto] stacked:gap-x-3', !u.is_active && 'text-muted-foreground')}>
                  <TableCell className="font-medium stacked:col-start-1 stacked:row-start-1">
                    {u.name}
                    {u.id === session.userId ? (
                      <Badge variant="outline" className="ml-2 align-middle">
                        {t.users.you}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="break-all whitespace-normal stacked:col-start-1 stacked:row-start-2 stacked:text-xs stacked:text-muted-foreground">{u.email}</TableCell>
                  <TableCell className="stacked:col-start-1 stacked:row-start-3 stacked:pt-1">
                    <span className="flex flex-wrap gap-1">
                      {rolesOf(u.role_ids, allRoles).map((r) => (
                        <Badge key={r.id} variant={r.key === 'admin' ? 'default' : 'secondary'}>
                          {roleName(r)}
                        </Badge>
                      ))}
                      {/* Stacked, an inactive account says so beside its roles; an active one needs no word. */}
                      {u.is_active ? null : (
                        <Badge variant="outline" className="hidden stacked:inline-flex">
                          {t.common.inactive}
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="stacked:hidden">
                    <Badge variant={u.is_active ? 'secondary' : 'outline'}>{u.is_active ? t.common.active : t.common.inactive}</Badge>
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap stacked:col-start-2 stacked:flex stacked:[grid-row:1/span_3] stacked:items-center stacked:gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEditing(u)} aria-label={t.users.editUserLabel(u.name)}>
                      {t.common.edit}
                    </Button>{' '}
                    <MoreActions label={t.common.moreActions(u.name)}>
                      <DropdownMenuItem onClick={() => setResetting(u)}>{t.users.resetPassword}</DropdownMenuItem>
                      {session.can('audit.read') ? (
                        <DropdownMenuItem onClick={() => navigate({ name: 'audit', filter: { entity_type: 'user', entity_id: u.id } })}>
                          {t.users.changes}
                        </DropdownMenuItem>
                      ) : null}
                    </MoreActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Loaded>
      <UserForm
        open={editing !== null}
        user={editing === 'new' || editing === null ? undefined : editing}
        roles={allRoles}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setEditing(null)
          setSaved(message)
          users.reload()
        }}
      />
      <ResetPassword user={resetting} onClose={() => setResetting(null)} />
    </>
  )
}

/** Add User (with a first password) or Edit User (profile, roles, active). */
function UserForm({
  open,
  user,
  roles,
  onClose,
  onSaved,
}: {
  open: boolean
  user: User | undefined
  roles: readonly Role[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const { client } = useApi()
  const session = useSession()
  const [d, setD] = useState<UserDraft>(() => draftOf(user, roles))
  const [errors, setErrors] = useState<UserErrors>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const isNew = !user
  const locks = ownAccountLocks(user, session.userId, roles)

  useEffect(() => {
    if (open) {
      setD(draftOf(user, roles))
      setErrors({})
      setServerError(undefined)
    }
  }, [open, user, roles])

  const clearError = (k: keyof UserErrors) => setErrors(({ [k]: _, ...rest }) => rest)
  const set = (k: 'name' | 'email' | 'password' | 'confirm') => (e: { target: { value: string } }) => {
    setD((cur) => ({ ...cur, [k]: e.target.value }))
    clearError(k)
  }
  const toggleRole = (r: Role, on: boolean) => {
    setD((cur) => {
      const ids = on ? [...cur.roleIds, r.id] : cur.roleIds.filter((x) => x !== r.id)
      return { ...cur, roleIds: rolesOf(ids, roles).map((x) => x.id) }
    })
    clearError('roles')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = validateUser(d, isNew)
    setErrors(v)
    setServerError(undefined)
    if (Object.keys(v).length > 0) return
    const name = d.name.trim()
    // Ask first before an account stops signing in, or loses Administrator.
    const deactivating = user?.is_active === true && !d.isActive
    const admin = roles.find((r) => r.key === 'admin')?.id
    const losingAdmin = admin !== undefined && user?.role_ids.includes(admin) === true && !d.roleIds.includes(admin)
    if (deactivating && !window.confirm(t.users.confirmDeactivate(name))) return
    if (losingAdmin && !window.confirm(t.users.confirmRemoveAdmin(name))) return
    setBusy(true)
    try {
      const profile = { name, email: d.email.trim(), role_ids: d.roleIds }
      if (user) await client.users.update(user.id, { ...profile, is_active: d.isActive })
      else await client.users.create({ ...profile, password: d.password })
      onSaved(!user ? t.users.addedUser(name) : deactivating ? t.users.deactivatedUser(name) : t.users.savedUser(name))
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) setErrors({ email: t.users.emailTaken })
      else setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={user ? t.users.editUser(user.name) : t.users.addUser}
      description={user ? t.users.editDescription : t.users.addDescription}
footer={<FormSheetActions form="user-form" onCancel={onClose} busy={busy} submitLabel={user ? undefined : t.users.addUser} />}
    >
      <form id="user-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label={t.users.name} required error={errors.name}>
          {(p) => <Input {...controlProps(p)} autoComplete="off" value={d.name} onChange={set('name')} autoFocus />}
        </Field>
        <Field label={t.users.email} required error={errors.email}>
          {(p) => (
            <Input {...controlProps(p)} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={d.email} onChange={set('email')} />
          )}
        </Field>

        <fieldset className="sm:col-span-2" aria-describedby={errors.roles ? 'user-roles-error' : undefined}>
          <legend className="mb-1.5 text-sm font-medium">
            {t.users.roles}<span className="text-destructive"> *</span>
          </legend>
          <div className="grid gap-1">
            {roles.map((r) => {
              const locked = locks.roleIds.includes(r.id)
              return (
                <label key={r.id} className={cn('flex min-h-11 items-start gap-3 rounded-md py-2 text-sm', locked && 'opacity-70')}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0 accent-primary"
                    checked={d.roleIds.includes(r.id)}
                    disabled={locked}
                    onChange={(e) => toggleRole(r, e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">{roleName(r)}</span>
                    <span className="block text-muted-foreground">
                      {roleGrants(r)}
                      {locked ? t.users.adminLocked : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          {errors.roles ? (
            <p id="user-roles-error" role="alert" className="mt-1 text-xs text-destructive">
              {errors.roles}
            </p>
          ) : null}
        </fieldset>

        {isNew ? (
          <>
            <Field label={t.users.password} required error={errors.password} hint={t.account.atLeast(MIN_PASSWORD_LENGTH)}>
              {(p) => <PasswordInput {...controlProps(p)} autoComplete="new-password" value={d.password} onChange={set('password')} />}
            </Field>
            <Field label={t.users.confirmPassword} required error={errors.confirm}>
              {(p) => <PasswordInput {...controlProps(p)} autoComplete="new-password" value={d.confirm} onChange={set('confirm')} />}
            </Field>
          </>
        ) : (
          <label className={cn('flex min-h-11 items-start gap-3 text-sm sm:col-span-2', locks.active && 'opacity-70')}>
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0 accent-primary"
              checked={d.isActive}
              disabled={locks.active}
              onChange={(e) => setD((cur) => ({ ...cur, isActive: e.target.checked }))}
            />
            <span>
              <span className="font-medium">{t.common.active}</span>
              <span className="block text-muted-foreground">
                {locks.active ? t.users.cannotDeactivateOwn : t.users.inactiveExplained}
              </span>
            </span>
          </label>
        )}

        {serverError ? (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {serverError}
          </p>
        ) : null}
      </form>
    </FormSheet>
  )
}

/** Reset password: the admin sets a new one without knowing the old. */
function ResetPassword({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { client } = useApi()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Pick<UserErrors, 'password' | 'confirm'>>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setPassword('')
    setConfirm('')
    setErrors({})
    setServerError(undefined)
    setDone(false)
  }, [user])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    const v = validateNewPassword(password, confirm)
    setErrors(v)
    setServerError(undefined)
    if (Object.keys(v).length > 0) return
    setBusy(true)
    try {
      await client.users.setPassword(user.id, password)
      setPassword('')
      setConfirm('')
      setDone(true)
    } catch (err) {
      setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={user !== null}
      onClose={onClose}
      title={t.users.resetTitle(user?.name ?? '')}
      description={t.users.resetDescription}
      footer={
        done ? (
          <Button onClick={onClose}>{t.users.done}</Button>
        ) : (
          <FormSheetActions form="reset-password-form" onCancel={onClose} busy={busy} submitLabel={t.users.setPassword} />
        )
      }
    >
      {done ? (
        <p role="status" className="text-sm">
          {t.users.passwordChangedFor(user?.name ?? '')}
        </p>
      ) : (
        <form id="reset-password-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label={t.account.newPassword} required error={errors.password} hint={t.account.atLeast(MIN_PASSWORD_LENGTH)}>
            {(p) => (
              <PasswordInput
                {...controlProps(p)}
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setErrors({})
                }}
                autoFocus
              />
            )}
          </Field>
          <Field label={t.account.confirmNewPassword} required error={errors.confirm}>
            {(p) => (
              <PasswordInput
                {...controlProps(p)}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => {
                  setConfirm(e.target.value)
                  setErrors({})
                }}
              />
            )}
          </Field>
          {serverError ? (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {serverError}
            </p>
          ) : null}
        </form>
      )}
    </FormSheet>
  )
}
