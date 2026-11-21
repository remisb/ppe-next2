import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { button, cleanup, render, settle } from '../test/ui-sdk.ts'
import { toast, Toaster } from './toast.tsx'

afterEach(() => {
  act(() => toast.dismiss())
  cleanup()
})

describe('Toaster', () => {
  it('is a named region at the top showing the title and the description', async () => {
    render(<Toaster />)
    act(() => void toast.success('Saved', { description: 'ID card saved to Rūta Žukauskaitė' }))
    await settle()
    const region = document.querySelector('[data-slot="toast-region"]')!
    expect(region.getAttribute('aria-label')).toBe('Notifications')
    expect(region.getAttribute('data-side')).toBe('top')
    const shown = document.querySelector('[data-slot="toast"]')!
    expect(shown.getAttribute('data-type')).toBe('success')
    expect(shown.textContent).toContain('Saved')
    expect(shown.textContent).toContain('ID card saved to Rūta Žukauskaitė')
  })

  it('closes on Close', async () => {
    render(<Toaster />)
    act(() => void toast('Scan deleted'))
    await settle()
    act(() => button('Close').click())
    await settle(500)
    expect(document.querySelector('[data-slot="toast"]')).toBeNull()
  })

  it('draws no Close for a toast that may not be dismissed', async () => {
    render(<Toaster />)
    act(() => void toast.loading('Saving…', { dismissible: false }))
    await settle()
    expect([...document.querySelectorAll('[data-slot="toast"] button')].map((b) => b.getAttribute('aria-label'))).toEqual([])
  })
})
