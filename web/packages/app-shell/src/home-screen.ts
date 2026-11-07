/**
 * The apps as an app on a phone's home screen (web/AGENTS.md, "Home-screen
 * app"): the manifest in the user's language, whether the app runs from the
 * home screen, the browser's own Install prompt where it has one (Chrome,
 * Edge, Samsung Internet), and the offline screen's service worker.
 */
import type { Lang } from '@ppe/i18n'
import { useSyncExternalStore } from 'react'

/** The manifest in a language: its name and the icon's shortcuts in it (public/manifest*.json). */
export function manifestHref(lang: Lang): string {
  return lang === 'en' ? '/manifest.json' : `/manifest.${lang}.json`
}

/** Points the page's manifest link at lang's, so an app installed now is named in it. */
export function localizeManifest(lang: Lang, doc: Document = document): void {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="manifest"]')
  if (link && link.getAttribute('href') !== manifestHref(lang)) link.setAttribute('href', manifestHref(lang))
}

/** Running from the home screen, in a window of its own: Android's standalone display, iOS's navigator.standalone. */
export function runsFromHomeScreen(win: Window = window): boolean {
  return win.matchMedia?.('(display-mode: standalone)').matches === true || (win.navigator as { standalone?: boolean }).standalone === true
}

/** An iPhone or iPad, where only the Share menu adds a page to the home screen (an iPad says it is a Mac with a touch screen). */
export function isIOS(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1)
}

/** Chrome's beforeinstallprompt event, which no TypeScript library types yet. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * What Account's Install app offers on this device: running (opened from the
 * home screen), ready (the browser's Install prompt), installed (just now),
 * share (iOS: Share, then Add to Home Screen) or none (a browser that cannot).
 */
export type InstallState = 'running' | 'ready' | 'installed' | 'share' | 'none'

let prompt: InstallPromptEvent | null = null
let installed = false
let watching = false
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

/**
 * Keeps the browser's Install prompt for Account's button instead of letting
 * it show its own banner. The browser offers it once, soon after the page
 * loads, so ApiProvider starts this at once.
 */
export function watchInstallPrompt(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    prompt = e as InstallPromptEvent
    changed()
  })
  window.addEventListener('appinstalled', () => {
    prompt = null
    installed = true
    changed()
  })
}

export function installState(): InstallState {
  if (runsFromHomeScreen()) return 'running'
  if (installed) return 'installed'
  if (prompt) return 'ready'
  return isIOS() ? 'share' : 'none'
}

/** Shows the browser's Install prompt; true when the person installed the app. A prompt is used once. */
export async function install(): Promise<boolean> {
  const p = prompt
  if (!p) return false
  prompt = null
  await p.prompt()
  const { outcome } = await p.userChoice
  if (outcome === 'accepted') installed = true
  changed()
  return outcome === 'accepted'
}

/** installState, kept current as the browser offers its prompt or installs the app. */
export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    installState,
    () => 'none',
  )
}

/**
 * Registers the offline screen's service worker (public/sw.js): when a page
 * of the origin cannot be loaded at all, it shows public/offline.html, which
 * tries again once the device is back online. It caches nothing else, so the
 * apps always come from the server. Only a production build registers it
 * (Vite's dev server serves the files in another way), and only where the
 * browser has service workers (https, or localhost).
 */
export function registerOfflineScreen(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return
  const register = () => void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
