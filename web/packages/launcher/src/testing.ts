import type { AppChannel, LauncherApp } from '@ppe/api-client'

/** A tile as the API sends it, with only what a test sets differing. */
export function tile(slug: string, more: Partial<LauncherApp> = {}): LauncherApp {
  return {
    id: slug, slug, kind: 'app', parent: '', group: 'workwear', icon: 'shirt', color: '#1c2060', href: `/${slug}/`, tier: 'here', stage: 'live',
    names: { en: slug, lt: `${slug} (lt)`, ru: `${slug} (ru)` }, any_of: [], position: 10, stable_follows_deploys: false, created_at: '', updated_at: '', updated_by_user_id: null, ...more,
  }
}

/** A channel as the API sends it, pointing at version. */
export function channel(name: AppChannel['name'], version: string, more: Partial<AppChannel> = {}): AppChannel {
  return {
    id: name, app_id: 'app', name, version_id: version, version, published_at: '2026-11-04T09:00:00Z',
    updated_at: '', updated_by_user_id: null, ...more,
  }
}
