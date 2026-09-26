import type { Role, User } from '@ppe/api-client'
import { ApiError } from '@ppe/api-client'
import { KeyRound, Plus } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { SortControl, SortableHead } from '@/components/sortable'
import { EmptyState, ErrorState, Loading, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field, Input, controlProps } from '@/components/ui/field'
import { FormSheet } from '@/components/ui/form-sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useApi, useSession } from '@/lib/api'
import { type SortColumn, type SortState, sortRows } from '@/lib/sort'
import { errorText, useLoad } from '@/lib/use-load'
import { type UserDraft, type UserErrors, draftOf, ownAccountLocks, roleLabel, roles, sortRoles, validateNewPassword, validateUser } from '@/lib/users'
import { cn } from '@/lib/utils'

type UserSort = 'name' | 'email' | 'roles' | 'status'

const columns: SortColumn<UserSort>[] = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'roles', label: 'Roles' },
  { key: 'status', label: 'Status' },
]

/** By the most powerful role: administrators, then managers, then employees. */
const roleRank = (u: User) => Math.min(...u.roles.map((r) => roles.findIndex((x) => x.role === r)).filter((i) => i >= 0), roles.length)

/**
 * Users: the accounts that sign in to this app. Administrators only; the
 * navigation shows the tab to them alone, and the API refuses everyone else.
 */
export function UsersPage() {
  const { client } = useApi()
  const session = useSession()
  const users = useLoad(() => (session.canManageUsers ? client.users.list() : Promise.resolve([])))
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<User | 'new' | null>(null)
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
          return roleRank(u)
        case 'status':
          return u.is_active ? 0 : 1
      }
    })
  }, [users.data, filter, sort])

  if (!session.canManageUsers) {
    return (
      <>
        <PageHeader title="Users" />
        <EmptyState>Only administrators can manage users.</EmptyState>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in, and what they may do. Inactive users cannot sign in; their past work keeps their name."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Add User
          </Button>
        }
      />
      <div className="mb-4 md:max-w-sm">
        <Input
          type="search"
          enterKeyHint="search"
          placeholder="Search by name or email"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Search users"
        />
      </div>
      {users.error ? (
        <ErrorState error={users.error} onRetry={users.reload} />
      ) : users.loading && !users.data ? (
        <Loading />
      ) : shown.length === 0 ? (
        <EmptyState>{filter ? `No users match “${filter.trim()}”.` : 'No users yet.'}</EmptyState>
      ) : (
        // Where the table is narrow each user is a card: name and status, email, roles, then actions.
        <Table stack="grid" sortControl={<SortControl columns={columns} {...sortProps} />}>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <SortableHead key={c.key} column={c} {...sortProps} />
              ))}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((u) => (
              <TableRow key={u.id} className={u.is_active ? undefined : 'text-muted-foreground'}>
                <TableCell className="font-medium stacked:order-1 stacked:w-auto stacked:flex-1 stacked:text-base stacked:font-semibold">
                  {u.name}
                  {u.id === session.userId ? (
                    <Badge variant="outline" className="ml-2 align-middle">
                      You
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="break-all whitespace-normal stacked:order-3 stacked:-mt-1 stacked:mb-1">{u.email}</TableCell>
                <TableCell label="Roles" className="stacked:order-4">
                  <span className="flex flex-wrap gap-1 stacked:justify-end">
                    {sortRoles(u.roles).map((r) => (
                      <Badge key={r} variant={r === 'admin' ? 'default' : 'secondary'}>
                        {roleLabel(r)}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell className="stacked:order-2 stacked:ml-auto stacked:w-auto">
                  <Badge variant={u.is_active ? 'outline' : 'secondary'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
                </TableCell>
                <TableCell className="space-x-1 text-right stacked:order-5 stacked:mt-2 stacked:flex stacked:gap-2 stacked:space-x-0 stacked:*:flex-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setResetting(u)} aria-label={`Reset password for ${u.name}`}>
                    <KeyRound aria-hidden /> Reset password
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <UserForm
        open={editing !== null}
        user={editing === 'new' || editing === null ? undefined : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          users.reload()
        }}
      />
      <ResetPassword user={resetting} onClose={() => setResetting(null)} />
    </>
  )
}

/** Add User (with a first password) or Edit User (profile, roles, active). */
function UserForm({ open, user, onClose, onSaved }: { open: boolean; user: User | undefined; onClose: () => void; onSaved: () => void }) {
  const { client } = useApi()
  const session = useSession()
  const [d, setD] = useState<UserDraft>(() => draftOf(user))
  const [errors, setErrors] = useState<UserErrors>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const isNew = !user
  const locks = ownAccountLocks(user, session.userId)

  useEffect(() => {
    if (open) {
      setD(draftOf(user))
      setErrors({})
      setServerError(undefined)
    }
  }, [open, user])

  const clearError = (k: keyof UserErrors) => setErrors(({ [k]: _, ...rest }) => rest)
  const set = (k: 'name' | 'email' | 'password' | 'confirm') => (e: { target: { value: string } }) => {
    setD((cur) => ({ ...cur, [k]: e.target.value }))
    clearError(k)
  }
  const toggleRole = (r: Role, on: boolean) => {
    setD((cur) => ({ ...cur, roles: sortRoles(on ? [...cur.roles, r] : cur.roles.filter((x) => x !== r)) }))
    clearError('roles')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = validateUser(d, isNew)
    setErrors(v)
    setServerError(undefined)
    if (Object.keys(v).length > 0) return
    setBusy(true)
    try {
      const profile = { name: d.name.trim(), email: d.email.trim(), roles: d.roles }
      if (user) await client.users.update(user.id, { ...profile, is_active: d.isActive })
      else await client.users.create({ ...profile, password: d.password })
      onSaved()
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) setErrors({ email: 'Another user already has this email address.' })
      else setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={user ? `Edit User: ${user.name}` : 'Add User'}
      description={user ? 'A role change applies from the user’s next sign-in.' : 'They sign in with this email and password, and can change the password under Account.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" disabled={busy}>
            {busy ? 'Saving…' : user ? 'Save' : 'Add User'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Name" required error={errors.name}>
          {(p) => <Input {...controlProps(p)} autoComplete="off" value={d.name} onChange={set('name')} autoFocus />}
        </Field>
        <Field label="Email" required error={errors.email}>
          {(p) => (
            <Input {...controlProps(p)} type="email" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} value={d.email} onChange={set('email')} />
          )}
        </Field>

        <fieldset className="sm:col-span-2" aria-describedby={errors.roles ? 'user-roles-error' : undefined}>
          <legend className="mb-1.5 text-sm font-medium">
            Roles<span className="text-destructive"> *</span>
          </legend>
          <div className="grid gap-1">
            {roles.map(({ role, label, grants }) => {
              const locked = role === 'admin' && locks.admin
              return (
                <label key={role} className={cn('flex min-h-11 items-start gap-3 rounded-md py-2 text-sm', locked && 'opacity-70')}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 shrink-0 accent-primary"
                    checked={d.roles.includes(role)}
                    disabled={locked}
                    onChange={(e) => toggleRole(role, e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">{label}</span>
                    <span className="block text-muted-foreground">
                      {grants}
                      {locked ? ' You cannot remove it from your own account.' : ''}
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
            <Field label="Password" required error={errors.password} hint="At least 8 characters.">
              {(p) => <Input {...controlProps(p)} type="password" autoComplete="new-password" value={d.password} onChange={set('password')} />}
            </Field>
            <Field label="Confirm password" required error={errors.confirm}>
              {(p) => <Input {...controlProps(p)} type="password" autoComplete="new-password" value={d.confirm} onChange={set('confirm')} />}
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
              <span className="font-medium">Active</span>
              <span className="block text-muted-foreground">
                {locks.active ? 'You cannot deactivate your own account.' : 'An inactive user cannot sign in. A token they already hold lasts until it expires.'}
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
      title={`Reset password: ${user?.name ?? ''}`}
      description="Give them the new password in person or by phone, not in a chat. They can change it under Account."
      footer={
        done ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="reset-password-form" disabled={busy}>
              {busy ? 'Saving…' : 'Set password'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <p role="status" className="text-sm">
          The password for {user?.name} has been changed.
        </p>
      ) : (
        <form id="reset-password-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="New password" required error={errors.password} hint="At least 8 characters.">
            {(p) => (
              <Input
                {...controlProps(p)}
                type="password"
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
          <Field label="Confirm new password" required error={errors.confirm}>
            {(p) => (
              <Input
                {...controlProps(p)}
                type="password"
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
