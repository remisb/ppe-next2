import { APP_ICONS, ApiError, type AppFeedback, type AppGroup, type AppKind, type AppStage, type AppTier, type LauncherApp, PERMISSIONS, type Permission } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { RecordChanges } from '@ppe/audit'
import { appIcons, appName } from '@ppe/launcher'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { Fact, FactGrid } from '@ppe/ui/components/facts'
import { Field, Input, Select, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { linkVariants } from '@ppe/ui/components/link'
import { DetailPane, ListDetail, PaneBar } from '@ppe/ui/components/list-detail'
import { RecordHeader, RecordTitle } from '@ppe/ui/components/record-header'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { Segmented } from '@ppe/ui/components/segmented'
import { ActionError, EmptyState, ErrorState, Loaded, Loading, PageHeader } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, stackedBreak } from '@ppe/ui/components/table'
import { useListKeys } from '@ppe/ui/lib/list-keys'
import { useAction } from '@ppe/ui/lib/use-action'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { cn } from '@ppe/ui/lib/utils'
import { ArrowDown, ArrowUp, Box, ExternalLink, Plus } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'

import { t } from '@/i18n'
import { type AppDraft, type AppErrors, SWATCHES, draftOf, inputOf, moveTarget, newInputOf, slugFrom, validateApp } from '@/lib/apps'
import { permissionLabel } from '@/lib/roles'
import { type Route, linkTo } from '@/lib/router'

import { AppReleases } from './app-releases'

type Navigate = (to: Route, options?: { scroll?: boolean }) => void

const groups: readonly AppGroup[] = ['workwear', 'assets', 'people', 'admin']
const stages: readonly AppStage[] = ['live', 'pilot', 'poc', 'dev', 'retired']

/**
 * Manage apps (ADR 0006): App Launcher's apps and shortcuts in its order, each
 * opened beside the list with where it runs, who sees it, a published app's
 * versions and channels, its feedback and Changes; Register app, Edit, and
 * moving a tile earlier or later.
 */
export function AppsPage({ route, navigate }: { route: Extract<Route, { name: 'apps' }>; navigate: Navigate }) {
  const { client } = useApi()
  const apps = useLoad(() => client.apps.list())
  const timeZone = useLoad(() => client.settings()).data?.timezone
  const [editing, setEditing] = useState<LauncherApp | 'new' | null>(null)
  const selected = route.app
  const open = (slug: string) => navigate({ name: 'apps', app: slug }, { scroll: false })
  const close = () => navigate({ name: 'apps' }, { scroll: false })
  const list = useMemo(() => apps.data ?? [], [apps.data])
  useListKeys({ ids: useMemo(() => list.map((a) => a.slug), [list]), selected, onOpen: open, onClose: close })
  const beside = selected !== undefined
  const current = list.find((a) => a.slug === selected)

  return (
    <>
      <ListDetail
        width="lg"
        pane={
          selected ? (
            <DetailPane label={current ? appName(current) : t.apps.title} next={t.apps.nextOrPrevious}>
              {current ? (
                <AppPane
                  key={current.slug}
                  app={current}
                  all={list}
                  timeZone={timeZone}
                  onClose={close}
                  onEdit={() => setEditing(current)}
                  onMoved={apps.reload}
                />
              ) : apps.loading ? (
                <Loading />
              ) : (
                <EmptyState>{t.apps.notFound}</EmptyState>
              )}
            </DetailPane>
          ) : null
        }
      >
        <PageHeader
          title={t.apps.title}
          description={t.apps.description}
          primary={{ label: t.apps.register, short: t.common.add, icon: Plus, onClick: () => setEditing('new') }}
        />
        <Loaded load={apps}>
          {(all) => (
            <Table stack="list" stackBelow={beside ? 'sm' : 'md'}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.apps.tile}</TableHead>
                  {beside ? null : <TableHead>{t.apps.group}</TableHead>}
                  <TableHead>{t.apps.stage}</TableHead>
                  {beside ? null : <TableHead>{t.apps.tier}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {all.map((a) => (
                  <TableRow
                    key={a.slug}
                    data-state={selected === a.slug ? 'selected' : undefined}
                    aria-current={selected === a.slug ? 'true' : undefined}
                    className={cn(stackedBreak, 'cursor-pointer stacked:hover:bg-muted/50 stacked:data-[state=selected]:bg-muted', a.stage === 'retired' && 'opacity-60')}
                    onClick={(ev) => {
                      if ((ev.target as Element).closest('a, button') || window.getSelection()?.toString()) return
                      open(a.slug)
                    }}
                  >
                    <TableCell className="whitespace-normal stacked:w-auto stacked:min-w-0 stacked:flex-1">
                      <span className="flex items-center gap-3">
                        <TileIcon app={a} className="size-9 rounded-lg p-1.5" />
                        <span className="min-w-0">
                          <a {...linkTo({ name: 'apps', app: a.slug }, () => open(a.slug))} className={linkVariants({ weight: 'medium' })}>
                            {appName(a)}
                          </a>
                          <span className="block font-mono text-xs text-muted-foreground">
                            {a.slug} · {t.apps.kinds[a.kind]}
                          </span>
                        </span>
                      </span>
                    </TableCell>
                    {beside ? null : <TableCell className="whitespace-nowrap text-muted-foreground stacked:hidden">{t.apps.groups[a.group]}</TableCell>}
                    <TableCell className="whitespace-nowrap stacked:w-auto">
                      <Badge variant={a.stage === 'live' ? 'outline' : 'secondary'}>{t.apps.stages[a.stage]}</Badge>
                    </TableCell>
                    {beside ? null : (
                      <TableCell className="whitespace-nowrap text-muted-foreground stacked:hidden">
                        {t.apps.tiers[a.tier]}
                        {a.tier === 'linked' ? <ExternalLink aria-hidden className="ml-1 inline size-3.5 align-[-2px]" /> : null}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Loaded>
      </ListDetail>
      <AppForm
        open={editing !== null}
        app={editing === 'new' || editing === null ? undefined : editing}
        all={list}
        onClose={() => setEditing(null)}
        onSaved={(saved) => {
          setEditing(null)
          apps.reload()
          open(saved.slug)
        }}
      />
    </>
  )
}

function TileIcon({ app, className }: { app: Pick<LauncherApp, 'icon' | 'color'>; className?: string }) {
  const Icon = appIcons[app.icon] ?? Box
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center text-white', className)} style={{ backgroundColor: app.color }}>
      <Icon className="size-full" />
    </span>
  )
}

function AppPane({
  app,
  all,
  timeZone,
  onClose,
  onEdit,
  onMoved,
}: {
  app: LauncherApp
  all: LauncherApp[]
  timeZone: string | undefined
  onClose: () => void
  onEdit: () => void
  onMoved: () => void
}) {
  const { client } = useApi()
  const action = useAction()
  const [moved, setMoved] = useState<string>()
  const order = all.map((a) => a.slug)
  const place = order.indexOf(app.slug) + 1
  const parent = app.parent ? all.find((a) => a.slug === app.parent) : undefined
  const move = (by: -1 | 1) => {
    const before = moveTarget(order, app.slug, by)
    if (before === null) return
    void action.run(async () => {
      const next = await client.apps.move(app.slug, before)
      onMoved()
      setMoved(t.apps.moved(appName(app), next.findIndex((a) => a.slug === app.slug) + 1, next.length))
    })
  }

  return (
    <article aria-label={appName(app)} className="flex flex-col gap-4">
      <PaneBar backLabel={t.apps.back} closeLabel={t.apps.close(appName(app))} onClose={onClose} className="self-start" />
      <RecordHeader
        className="mb-0"
        nav={{ backLabel: t.apps.back, onBack: onClose, closeLabel: t.apps.close(appName(app)) }}
        title={
          <span className="flex items-center gap-3">
            <TileIcon app={app} className="size-11 rounded-xl p-2" />
            <RecordTitle className="text-lg">{appName(app)}</RecordTitle>
          </span>
        }
        actions={
          <Button variant="outline" onClick={onEdit}>
            {t.common.edit}
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">
          {t.apps.kinds[app.kind]} · {t.apps.stages[app.stage]}
        </p>
      </RecordHeader>
      <FactGrid layout="rows" ruled>
        <Fact label={t.apps.slug}>
          <code className="text-xs">{app.slug}</code>
        </Fact>
        {parent ? <Fact label={t.apps.parent}>{appName(parent)}</Fact> : null}
        <Fact label={t.apps.group}>{t.apps.groups[app.group]}</Fact>
        <Fact label={t.apps.tier}>{t.apps.tiers[app.tier]}</Fact>
        <Fact label={t.apps.address}>
          <code className="text-xs break-all">{app.href}</code>
        </Fact>
        <Fact label={t.apps.names}>
          {app.names.en} · {app.names.lt} · {app.names.ru}
        </Fact>
        <Fact label={t.apps.audience}>{app.any_of.length === 0 ? t.apps.everyone : app.any_of.map(permissionLabel).join(', ')}</Fact>
        <Fact label={t.apps.order}>
          <span className="flex flex-wrap items-center gap-2">
            {t.apps.place(place, order.length)}
            <Button variant="ghost" size="icon-sm" aria-label={t.apps.moveEarlier} title={t.apps.moveEarlier} disabled={place === 1 || action.pending} onClick={() => move(-1)}>
              <ArrowUp aria-hidden className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t.apps.moveLater}
              title={t.apps.moveLater}
              disabled={place === order.length || action.pending}
              onClick={() => move(1)}
            >
              <ArrowDown aria-hidden className="size-4" />
            </Button>
          </span>
          {moved ? (
            <span role="status" className="block text-xs text-muted-foreground">
              {moved}
            </span>
          ) : null}
        </Fact>
      </FactGrid>
      <ActionError error={action.error} />
      {app.kind === 'app' && app.tier === 'here' ? <AppReleases app={app} timeZone={timeZone} onChanged={onMoved} /> : null}
      {app.kind === 'app' ? <Feedback slug={app.slug} timeZone={timeZone} /> : null}
      <RecordChanges
        className="mb-0"
        load={() => client.audit.history('apps', app.id)}
        deps={[app.id, app.updated_at, app.position]}
        timeZone={timeZone}
        rememberAs="app-changes"
      />
    </article>
  )
}

function Feedback({ slug, timeZone }: { slug: string; timeZone: string | undefined }) {
  const { client } = useApi()
  const feedback = useLoad(() => client.apps.feedback(slug), [slug])
  return (
    <DisclosureSection id="app-feedback" title={t.apps.feedback} className="mb-0">
      {feedback.error ? (
        <ErrorState error={feedback.error} onRetry={feedback.reload} />
      ) : !feedback.data ? (
        <Loading />
      ) : feedback.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.apps.noFeedback}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {feedback.data.map((f: AppFeedback) => (
            <li key={f.id} className="rounded-lg border border-border p-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge variant={f.rating === 'broken' ? 'destructive' : f.rating === 'confusing' ? 'secondary' : 'outline'}>{t.apps.ratings[f.rating]}</Badge>
                <span className="font-medium">{f.user_name}</span>
                <span className="text-muted-foreground">
                  {t.apps.devices[f.device]} · {f.language.toUpperCase()} · <RelativeDate iso={f.created_at} timeZone={timeZone} />
                </span>
              </p>
              {f.text ? <p className="mt-1 whitespace-pre-wrap">{f.text}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </DisclosureSection>
  )
}

/** Register app, or Edit: every field of a tile; the kind and slug are set once. */
function AppForm({
  open,
  app,
  all,
  onClose,
  onSaved,
}: {
  open: boolean
  app: LauncherApp | undefined
  all: LauncherApp[]
  onClose: () => void
  onSaved: (app: LauncherApp) => void
}) {
  const { client } = useApi()
  const [d, setD] = useState<AppDraft>(() => draftOf(app))
  const [errors, setErrors] = useState<AppErrors>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)
  const isNew = !app

  useEffect(() => {
    if (open) {
      setD(draftOf(app))
      setErrors({})
      setServerError(undefined)
      setSlugTouched(false)
    }
  }, [open, app])

  const set = (patch: Partial<AppDraft>) => setD((cur) => ({ ...cur, ...patch }))
  const parents = all.filter((a) => a.kind === 'app' && a.tier === 'here')
  const tier: AppTier = d.kind === 'shortcut' ? 'here' : d.tier

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = validateApp(d, isNew)
    setErrors(v)
    setServerError(undefined)
    if (Object.keys(v).length > 0) return
    setBusy(true)
    try {
      onSaved(app ? await client.apps.update(app.slug, inputOf(d)) : await client.apps.create(newInputOf(d)))
    } catch (err) {
      if (err instanceof ApiError && err.isConflict) setErrors({ slug: t.apps.slugTaken })
      else setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      wide
      title={app ? t.apps.editApp(appName(app)) : t.apps.register}
      description={app ? t.apps.editDescription : t.apps.registerDescription}
      footer={<FormSheetActions form="app-form" onCancel={onClose} busy={busy} submitLabel={app ? undefined : t.apps.register} />}
    >
      <form id="app-form" onSubmit={submit} className="grid gap-4" noValidate>
        {isNew ? (
          <Field label={t.apps.kind} hint={t.apps.kindHints[d.kind]}>
            {() => (
              <Segmented<AppKind>
                label={t.apps.kind}
                options={(['app', 'shortcut'] as const).map((k) => ({ value: k, label: t.apps.kinds[k] }))}
                value={d.kind}
                onChange={(kind) => set({ kind })}
              />
            )}
          </Field>
        ) : null}
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-1.5 text-sm font-medium">{t.apps.names}</legend>
          {(['en', 'lt', 'ru'] as const).map((lang) => (
            <Field key={lang} label={t.apps.nameIn[lang]} required error={lang === 'en' ? errors.names : undefined}>
              {(p) => (
                <Input
                  {...controlProps(p)}
                  lang={lang}
                  autoComplete="off"
                  maxLength={60}
                  value={d.names[lang]}
                  autoFocus={isNew && lang === 'en'}
                  onChange={(e) => {
                    const names = { ...d.names, [lang]: e.target.value }
                    set(isNew && lang === 'en' && !slugTouched ? { names, slug: slugFrom(e.target.value) } : { names })
                  }}
                />
              )}
            </Field>
          ))}
        </fieldset>
        {isNew ? (
          <Field label={t.apps.slug} required hint={t.apps.slugHint} error={errors.slug}>
            {(p) => (
              <Input
                {...controlProps(p)}
                className="font-mono"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={d.slug}
                onChange={(e) => {
                  setSlugTouched(true)
                  set({ slug: e.target.value })
                }}
              />
            )}
          </Field>
        ) : null}
        {d.kind === 'shortcut' ? (
          <Field label={t.apps.parent} required hint={t.apps.parentHint} error={errors.parent}>
            {(p) => (
              <Select {...controlProps(p)} value={d.parent} onChange={(e) => set({ parent: e.target.value })}>
                <option value="" />
                {parents.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {appName(a)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label={t.apps.tier} hint={t.apps.tierHints[tier]}>
            {() => (
              <Segmented<AppTier>
                label={t.apps.tier}
                options={(['here', 'linked'] as const).map((k) => ({ value: k, label: t.apps.tiers[k] }))}
                value={tier}
                onChange={(next) => set({ tier: next })}
              />
            )}
          </Field>
        )}
        <Field label={t.apps.address} required hint={tier === 'here' ? t.apps.addressHere : t.apps.addressLinked} error={errors.href}>
          {(p) => (
            <Input
              {...controlProps(p)}
              className="font-mono"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={d.href}
              onChange={(e) => set({ href: e.target.value })}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.apps.group}>
            {(p) => (
              <Select {...controlProps(p)} value={d.group} onChange={(e) => set({ group: e.target.value as AppGroup })}>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {t.apps.groups[g]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t.apps.stage} hint={t.apps.stageHints[d.stage]}>
            {(p) => (
              <Select {...controlProps(p)} value={d.stage} onChange={(e) => set({ stage: e.target.value as AppStage })}>
                {stages.map((s) => (
                  <option key={s} value={s}>
                    {t.apps.stages[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t.apps.picture}</legend>
          <div role="radiogroup" aria-label={t.apps.picture} className="flex flex-wrap gap-2">
            {APP_ICONS.map((icon) => {
              const Icon = appIcons[icon]
              return (
                <label
                  key={icon}
                  className="grid size-11 cursor-pointer place-items-center rounded-lg border border-border has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-2 has-focus-visible:ring-ring"
                >
                  <input type="radio" name="app-icon" value={icon} checked={d.icon === icon} onChange={() => set({ icon })} className="sr-only" aria-label={icon} />
                  <Icon aria-hidden className="size-5" />
                </label>
              )
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t.apps.color}</legend>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={d.color === c}
                onClick={() => set({ color: c })}
                className="size-11 cursor-pointer rounded-lg border-2 border-transparent aria-pressed:border-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                style={{ backgroundColor: c }}
              />
            ))}
            <Field label={t.apps.color} hint={t.apps.colorHint} error={errors.color}>
              {(p) => <Input {...controlProps(p)} className="w-32 font-mono" value={d.color} onChange={(e) => set({ color: e.target.value })} />}
            </Field>
            <TileIcon app={{ icon: d.icon, color: /^#[0-9a-f]{6}$/i.test(d.color.trim()) ? d.color.trim() : '#000000' }} className="size-16 rounded-2xl p-3" />
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t.apps.audience}</legend>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" className="size-5 accent-primary" checked={d.everyone} onChange={(e) => set({ everyone: e.target.checked })} />
            <span className="font-medium">{t.apps.everyone}</span>
          </label>
          {d.everyone ? null : (
            <div className="mt-1 grid gap-1">
              <p className="text-sm text-muted-foreground">{t.apps.anyOfThese}</p>
              <div className="grid gap-x-4 sm:grid-cols-2">
                {PERMISSIONS.map((p: Permission) => (
                  <label key={p} className="flex min-h-11 items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-primary"
                      checked={d.anyOf.includes(p)}
                      onChange={(e) => set({ anyOf: e.target.checked ? PERMISSIONS.filter((k) => k === p || d.anyOf.includes(k)) : d.anyOf.filter((k) => k !== p) })}
                    />
                    {permissionLabel(p)}
                  </label>
                ))}
              </div>
            </div>
          )}
          {errors.audience ? (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {errors.audience}
            </p>
          ) : null}
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
