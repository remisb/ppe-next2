import { EmptyState, PageHeader } from '@ppe/ui/components/states'

import { t } from '@/i18n'

/** The app's first screen. */
export function HomePage() {
  return (
    <>
      <PageHeader title={t.shell.appName} />
      <EmptyState>{t.home.empty}</EmptyState>
    </>
  )
}
