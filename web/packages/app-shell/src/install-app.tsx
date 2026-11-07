import { Button } from '@ppe/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@ppe/ui/components/card'
import { cn } from '@ppe/ui/lib/utils'
import { CheckCircle2, Download, Share } from 'lucide-react'
import { useState } from 'react'

import { install, useInstallState } from './home-screen.ts'
import { shellText } from './text.ts'

/**
 * Account's Install app: adds the app to this device's home screen with the
 * browser's own prompt (Android's Chrome, a desktop's Chrome or Edge), or
 * says how on an iPhone or iPad (Share, then Add to Home Screen). Opened from
 * the home screen, it says so. A browser that can do neither shows nothing.
 */
export function InstallApp({ className }: { className?: string }) {
  const state = useInstallState()
  const [busy, setBusy] = useState(false)
  if (state === 'none') return null
  const text = shellText()
  const add = async () => {
    setBusy(true)
    try {
      await install()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className={cn('md:max-w-md', className)} data-slot="install-app">
      <CardHeader>
        <CardTitle>{text.installApp}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state === 'ready' ? (
          <>
            <p className="text-sm text-muted-foreground">{text.installAppHint}</p>
            <Button className="self-start" disabled={busy} onClick={() => void add()}>
              <Download aria-hidden />
              {text.installApp}
            </Button>
          </>
        ) : state === 'share' ? (
          <p className="text-sm text-muted-foreground">
            <Share aria-hidden className="mr-1 inline size-4 align-text-bottom" />
            {text.installAppShare}
          </p>
        ) : (
          <p className="flex items-start gap-2 text-sm">
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            {state === 'running' ? text.installAppRunning : text.installAppInstalled}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
