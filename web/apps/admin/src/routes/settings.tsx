import { useApi } from '@ppe/app-shell'
import { Button } from '@ppe/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@ppe/ui/components/card'
import { Field, Input, controlProps } from '@ppe/ui/components/field'
import { ErrorState, Loading, PageHeader } from '@ppe/ui/components/states'
import { errorText, useLoad } from '@ppe/ui/lib/use-load'
import { ExternalLink } from 'lucide-react'
import { type FormEvent, useEffect, useState } from 'react'

import { t } from '@/i18n'
import { type SupplierChatErrors, checkSupplierChat } from '@/lib/supplier-chat'

/**
 * Settings (/settings, administrators only): the organisation's settings. Today
 * the supplier's WhatsApp group, which Copy for WhatsApp opens for an order
 * message (WhatsApp cannot open a group with the message typed in, so staff
 * paste it there). Saving both fields empty removes the group.
 */
export function SettingsPage() {
  const { client } = useApi()
  const settings = useLoad(() => client.settings())
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [errors, setErrors] = useState<SupplierChatErrors>({})
  const [serverError, setServerError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'saved' | 'cleared'>()
  const chat = settings.data?.supplier_chat ?? null

  // The form starts from what is saved, and again after each save.
  useEffect(() => {
    setName(chat?.name ?? '')
    setLink(chat?.link ?? '')
  }, [chat?.name, chat?.link])

  const save = async (next: { name: string; link: string }) => {
    const found = checkSupplierChat(next.name, next.link)
    setErrors(found)
    setServerError(undefined)
    setDone(undefined)
    if (found.name || found.link) return
    setBusy(true)
    try {
      await client.updateSupplierChat({ name: next.name.trim(), link: next.link.trim() })
      setDone(next.link.trim() ? 'saved' : 'cleared')
      settings.reload()
    } catch (err) {
      setServerError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save({ name, link })
  }

  return (
    <>
      <PageHeader title={t.settings.title} description={t.settings.description} />
      {settings.error ? (
        <ErrorState error={settings.error} onRetry={settings.reload} />
      ) : !settings.data ? (
        <Loading />
      ) : (
        <Card className="md:max-w-xl">
          <CardHeader>
            <CardTitle>{t.settings.supplierChat}</CardTitle>
            <CardDescription>{t.settings.supplierChatIntro}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p role="status" className="text-sm">
              {done === 'saved' ? `${t.settings.saved} ` : done === 'cleared' ? `${t.settings.cleared} ` : null}
              {done !== 'cleared' ? (chat ? t.settings.current(chat.name) : t.settings.notSet) : null}{' '}
              {chat ? (
                <a href={chat.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-medium underline underline-offset-4">
                  {t.settings.tryIt} <ExternalLink aria-hidden className="size-3" />
                </a>
              ) : null}
            </p>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <Field label={t.settings.groupName} hint={t.settings.groupNameHint} error={errors.name ? t.settings.nameRequired : undefined}>
                {(p) => <Input {...controlProps(p)} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Field label={t.settings.inviteLink} hint={t.settings.inviteLinkHint} error={errors.link ? t.settings.invalidLink : serverError}>
                {(p) => (
                  <Input
                    {...controlProps(p)}
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="https://chat.whatsapp.com/…"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? t.settings.saving : t.settings.save}
                </Button>
                {chat ? (
                  <Button type="button" variant="outline" disabled={busy} onClick={() => void save({ name: '', link: '' })}>
                    {t.settings.clear}
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </>
  )
}
