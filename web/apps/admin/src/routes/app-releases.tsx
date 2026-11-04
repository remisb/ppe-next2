import { ApiError, type AppChannel, type AppNames, type AppVersion, type LauncherApp, PERMISSIONS, type Permission } from '@ppe/api-client'
import { useApi } from '@ppe/app-shell'
import { FIXED_CHANNELS, channelName, isVariant } from '@ppe/launcher'
import { Badge } from '@ppe/ui/components/badge'
import { Button } from '@ppe/ui/components/button'
import { DisclosureSection } from '@ppe/ui/components/disclosure-section'
import { DropdownMenuItem } from '@ppe/ui/components/dropdown-menu'
import { Field, Input, Select, controlProps } from '@ppe/ui/components/field'
import { FormSheet, FormSheetActions } from '@ppe/ui/components/form-sheet'
import { MoreActions } from '@ppe/ui/components/more-actions'
import { RelativeDate } from '@ppe/ui/components/relative-date'
import { ActionError, ErrorState, Loading } from '@ppe/ui/components/states'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@ppe/ui/components/table'
import { useAction } from '@ppe/ui/lib/use-action'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { Plus } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'

import { t } from '@/i18n'
import { type VariantDraft, validateVariant, variantDraftOf } from '@/lib/apps'
import { permissionLabel } from '@/lib/roles'

/**
 * A published app's versions and channels (ADR 0006, phase 3): which version
 * each channel opens and who sees it; Make Stable, Beta or Preview on any
 * version (promoting, or rolling back to an older one), and variants with
 * their own label and audience. An app on an address of its own has none,
 * and says how one is published.
 */
export function AppReleases({ app, timeZone, onChanged }: { app: LauncherApp; timeZone: string | undefined; onChanged: () => void }) {
  const { client } = useApi()
  const releases = useLoad(() => client.apps.releases(app.slug), [app.slug])
  const action = useAction()
  const [done, setDone] = useState<string>()
  const [variant, setVariant] = useState<AppChannel | 'new' | null>(null)
  const channels = releases.data?.channels ?? []
  const versions = releases.data?.versions ?? []

  const point = (name: string, version: AppVersion) =>
    void action.run(async () => {
      await client.apps.pointChannel(app.slug, name, { version: version.version })
      releases.reload()
      onChanged()
      setDone(t.apps.channelMoved(channelName(name, channels), version.version))
    })

  return (
    <DisclosureSection id="app-releases" title={t.apps.releases} count={versions.length || undefined} rememberAs="app-releases" className="mb-0">
      {releases.error ? (
        <ErrorState error={releases.error} onRetry={releases.reload} />
      ) : !releases.data ? (
        <Loading />
      ) : versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.apps.notPublished}</p>
      ) : (
        <div className="flex flex-col gap-4">
          <section aria-label={t.apps.channels} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{t.apps.channels}</h3>
              <Button variant="outline" size="sm" onClick={() => setVariant('new')}>
                <Plus aria-hidden className="size-4" />
                {t.apps.addVariant}
              </Button>
            </div>
            <ul className="flex flex-col gap-2">
              {channels.map((c) => (
                <li key={c.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border p-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {channelName(c.name, channels)}
                      <code className="text-xs font-normal text-muted-foreground">{c.version}</code>
                    </span>
                    <span className="block text-xs text-muted-foreground">{whoSees(c)}</span>
                  </span>
                  {isVariant(c.name) ? (
                    <Button variant="ghost" size="sm" onClick={() => setVariant(c)}>
                      {t.common.edit}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          <section aria-label={t.apps.versions} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t.apps.versions}</h3>
            <Table stack="list" stackBelow="md">
              <TableHeader>
                <TableRow>
                  <TableHead>{t.apps.version}</TableHead>
                  <TableHead>{t.apps.publishedAt}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t.apps.actionsColumn}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => {
                  const on = channels.filter((c) => c.version_id === v.id)
                  return (
                    <TableRow key={v.id}>
                      <TableCell className="whitespace-normal stacked:w-auto stacked:min-w-0 stacked:flex-1">
                        <code className="text-xs">{v.version}</code>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {on.map((c) => (
                            <Badge key={c.name} variant={c.name === 'stable' ? 'default' : 'secondary'}>
                              {channelName(c.name, channels)}
                            </Badge>
                          ))}
                          <span className="text-xs text-muted-foreground">
                            {t.apps.profiles[v.profile]}
                            {v.commit ? ` · ${v.commit}` : ''}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        <RelativeDate iso={v.published_at} timeZone={timeZone} />
                      </TableCell>
                      <TableCell className="w-0 text-right stacked:w-auto">
                        <MoreActions label={t.apps.versionActions(v.version)}>
                          {FIXED_CHANNELS.map((name) => (
                            <DropdownMenuItem key={name} disabled={on.some((c) => c.name === name) || action.pending} onClick={() => point(name, v)}>
                              {t.apps.makeChannel(channelName(name))}
                            </DropdownMenuItem>
                          ))}
                          {channels.filter((c) => isVariant(c.name)).map((c) => (
                            <DropdownMenuItem key={c.name} disabled={c.version_id === v.id || action.pending} onClick={() => point(c.name, v)}>
                              {t.apps.makeChannel(channelName(c.name, channels))}
                            </DropdownMenuItem>
                          ))}
                        </MoreActions>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </section>
          <ActionError error={action.error} />
          {done ? (
            <p role="status" className="text-sm text-muted-foreground">
              {done}
            </p>
          ) : null}
        </div>
      )}
      <VariantForm
        slug={app.slug}
        open={variant !== null}
        channel={variant === 'new' || variant === null ? undefined : variant}
        channels={channels}
        versions={versions}
        onClose={() => setVariant(null)}
        onSaved={() => {
          setVariant(null)
          releases.reload()
          onChanged()
        }}
      />
    </DisclosureSection>
  )
}

/** Who sees a channel: Stable whoever sees the app; any other its audience, or testers. */
function whoSees(c: AppChannel): string {
  if (c.name === 'stable') return t.apps.seenByApp
  if (c.any_of.length === 0) return t.apps.seenByTesters
  return t.apps.seenBy(c.any_of.map(permissionLabel).join(', '))
}

/** Add variant, or Edit one: its name (set once), label, version and audience. */
function VariantForm({
  slug,
  open,
  channel,
  channels,
  versions,
  onClose,
  onSaved,
}: {
  slug: string
  open: boolean
  channel: AppChannel | undefined
  channels: AppChannel[]
  versions: AppVersion[]
  onClose: () => void
  onSaved: () => void
}) {
  const { client } = useApi()
  const [d, setD] = useState<VariantDraft>(() => variantDraftOf(channel, versions))
  const [errors, setErrors] = useState<ReturnType<typeof validateVariant>>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setD(variantDraftOf(channel, versions))
      setErrors({})
      setServerError(undefined)
    }
  }, [open, channel, versions])

  const set = (patch: Partial<VariantDraft>) => setD((cur) => ({ ...cur, ...patch }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = validateVariant(d, channel ? [] : channels.map((c) => c.name))
    setErrors(v)
    setServerError(undefined)
    if (Object.keys(v).length > 0) return
    setBusy(true)
    try {
      const label: AppNames = { en: d.label.en.trim(), lt: d.label.lt.trim(), ru: d.label.ru.trim() }
      await client.apps.pointChannel(slug, d.name.trim(), { version: d.version, label, any_of: d.anyOf })
      onSaved()
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      wide
      title={channel ? t.apps.editVariant(channelName(channel.name, channels)) : t.apps.addVariant}
      description={t.apps.variantDescription}
      footer={<FormSheetActions form="variant-form" onCancel={onClose} busy={busy} submitLabel={channel ? undefined : t.apps.addVariant} />}
    >
      <form id="variant-form" onSubmit={submit} className="grid gap-4" noValidate>
        {channel ? null : (
          <Field label={t.apps.variantName} required hint={t.apps.variantNameHint} error={errors.name}>
            {(p) => (
              <Input
                {...controlProps(p)}
                className="font-mono"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                value={d.name}
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
        )}
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-1.5 text-sm font-medium">{t.apps.variantLabel}</legend>
          {(['en', 'lt', 'ru'] as const).map((lang) => (
            <Field key={lang} label={t.apps.nameIn[lang]} required error={lang === 'en' ? errors.label : undefined}>
              {(p) => (
                <Input
                  {...controlProps(p)}
                  lang={lang}
                  autoComplete="off"
                  maxLength={60}
                  value={d.label[lang]}
                  onChange={(e) => set({ label: { ...d.label, [lang]: e.target.value } })}
                />
              )}
            </Field>
          ))}
        </fieldset>
        <Field label={t.apps.version} required error={errors.version}>
          {(p) => (
            <Select {...controlProps(p)} value={d.version} onChange={(e) => set({ version: e.target.value })}>
              {versions.map((v) => (
                <option key={v.id} value={v.version}>
                  {v.version}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">{t.apps.audience}</legend>
          <p className="text-sm text-muted-foreground">{t.apps.variantAudienceHint}</p>
          <div className="mt-1 grid gap-x-4 sm:grid-cols-2">
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
