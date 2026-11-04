import type { LauncherApp } from '@ppe/api-client'

/** A tile as the API sends it, with only what a test sets differing. */
export function tile(slug: string, more: Partial<LauncherApp> = {}): LauncherApp {
  return {
    id: slug, slug, kind: 'app', parent: '', group: 'workwear', icon: 'shirt', color: '#1c2060', href: `/${slug}/`, tier: 'here', stage: 'live',
    names: { en: slug, lt: `${slug} (lt)`, ru: `${slug} (ru)` }, any_of: [], position: 10, created_at: '', updated_at: '', updated_by_user_id: null, ...more,
  }
}
