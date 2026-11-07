import { describe, expect, it, vi } from 'vitest'

import { install, installState, isIOS, localizeManifest, manifestHref, runsFromHomeScreen, watchInstallPrompt } from './home-screen.ts'

const standalone = (matches: boolean, iosStandalone?: boolean) =>
  ({ matchMedia: () => ({ matches }), navigator: iosStandalone === undefined ? {} : { standalone: iosStandalone } }) as unknown as Window

describe('the home-screen app', () => {
  it('is installed in the language in use: the page links that language’s manifest', () => {
    document.head.innerHTML = '<link rel="manifest" href="/manifest.json">'
    localizeManifest('lt')
    expect(document.querySelector('link[rel=manifest]')?.getAttribute('href')).toBe('/manifest.lt.json')
    localizeManifest('en')
    expect(document.querySelector('link[rel=manifest]')?.getAttribute('href')).toBe('/manifest.json')
    expect(manifestHref('ru')).toBe('/manifest.ru.json')
    // A page without a manifest (a published app) is left alone.
    document.head.innerHTML = ''
    expect(() => localizeManifest('ru')).not.toThrow()
  })

  it('knows when it runs from the home screen, on Android and on iOS', () => {
    expect(runsFromHomeScreen(standalone(true))).toBe(true)
    expect(runsFromHomeScreen(standalone(false, true))).toBe(true)
    expect(runsFromHomeScreen(standalone(false, false))).toBe(false)
  })

  it('knows an iPhone and an iPad, which says it is a Mac with a touch screen', () => {
    expect(isIOS({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 })).toBe(true)
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe(true)
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe(false)
    expect(isIOS({ userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)', maxTouchPoints: 5 })).toBe(false)
  })

  it("keeps the browser's Install prompt for Install app, and says when the app is installed", async () => {
    expect(installState()).toBe('none')
    watchInstallPrompt()
    const offered = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}),
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    })
    window.dispatchEvent(offered)
    // The browser's own banner is held back.
    expect(offered.defaultPrevented).toBe(true)
    expect(installState()).toBe('ready')
    expect(await install()).toBe(true)
    expect(offered.prompt).toHaveBeenCalledOnce()
    expect(installState()).toBe('installed')
    // A prompt is used once.
    expect(await install()).toBe(false)
  })
})
