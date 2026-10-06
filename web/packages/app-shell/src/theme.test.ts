import { afterEach, describe, expect, it } from 'vitest'

import { applyTheme, loadTheme, saveTheme } from './theme.ts'

afterEach(() => {
  window.localStorage.clear()
  applyTheme('system')
})

describe('theme', () => {
  it('is the device’s own setting until one is chosen, and then that one', () => {
    expect(loadTheme()).toBe('system')
    saveTheme('dark')
    expect(loadTheme()).toBe('dark')
    saveTheme('system')
    expect(window.localStorage.getItem('workwear.theme')).toBeNull()
    window.localStorage.setItem('workwear.theme', 'purple')
    expect(loadTheme()).toBe('system')
  })

  it('pins the page to light or dark, and lets the device decide again for system', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset['theme']).toBe('dark')
    applyTheme('light')
    expect(document.documentElement.dataset['theme']).toBe('light')
    applyTheme('system')
    expect(document.documentElement.dataset['theme']).toBeUndefined()
  })

  it('colours the browser’s bars to match', () => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)">'
    const colours = () => [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) => m.content)
    applyTheme('dark')
    expect(colours()).toEqual(['#0a0a0a', '#0a0a0a'])
    applyTheme('system')
    expect(colours()).toEqual(['#ffffff', '#0a0a0a'])
  })
})
