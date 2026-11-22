import { act, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { button, cleanup, render, settle } from '../test/ui-sdk.ts'
import { ActionSheet, createActionSheet, Drawer } from './drawer.tsx'

afterEach(() => cleanup())

type Choice = 'download' | 'delete'

function sheetWith() {
  const sheet = createActionSheet<Choice>()
  render(
    <ActionSheet
      sheet={sheet}
      title="Delete this scan?"
      description="Its photos are deleted from Scans."
      actions={[
        { value: 'download', label: 'Download Archive' },
        { value: 'delete', label: 'Delete Scan', destructive: true },
      ]}
    />,
  )
  return sheet
}

describe('ActionSheet', () => {
  it('names itself and draws every choice, Cancel apart and the destructive one red', async () => {
    const sheet = sheetWith()
    act(() => void sheet.open())
    await settle()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('Delete this scan?')
    expect(button('Download Archive').className).toContain('text-primary')
    expect(button('Delete Scan').className).toContain('text-destructive')
    expect(button('Cancel').hasAttribute('aria-disabled')).toBe(false)
  })

  it('answers with the choice pressed', async () => {
    const sheet = sheetWith()
    let answer: Promise<{ returnValue?: Choice | undefined }> | undefined
    act(() => void (answer = sheet.open()))
    await settle()
    act(() => button('Delete Scan').click())
    await settle()
    expect((await answer!).returnValue).toBe('delete')
  })

  it('answers with nothing for Cancel', async () => {
    const sheet = sheetWith()
    let answer: Promise<{ returnValue?: Choice | undefined }> | undefined
    act(() => void (answer = sheet.open()))
    await settle()
    act(() => button('Cancel').click())
    await settle()
    expect((await answer!).returnValue).toBeUndefined()
  })
})

function Controlled({ onChange }: { onChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Details
      </button>
      <Drawer
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          onChange(next)
        }}
        title="ID card"
        description="Read today"
        snapPoints={[0.5, 1]}
        footer={<button type="button">Find Employee</button>}
      >
        <p>Surname</p>
      </Drawer>
    </>
  )
}

describe('Drawer', () => {
  it('opens named, with a handle for its two resting points, and returns focus when Escape closes it', async () => {
    const changes: boolean[] = []
    render(<Controlled onChange={(o) => changes.push(o)} />)
    const opener = button('Details')
    opener.focus()
    act(() => opener.click())
    await settle()
    const dialog = document.querySelector('[role="dialog"]')!
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('ID card')
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('Read today')
    expect(button('Resize sheet')).toBeTruthy()
    expect(button('Find Employee')).toBeTruthy()
    act(() => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle(50)
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.every((open) => !open)).toBe(true)
    expect(document.activeElement).toBe(opener)
  })

  it('has a plain bar, not a handle, when it rests in one place', async () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Scan">
        <p>Pages</p>
      </Drawer>,
    )
    await settle()
    expect(document.querySelector('[data-slot="drawer-handle"]')).toBeNull()
  })
})

describe('without <meta property="csp-nonce">', () => {
  it('ui-sdk adds its CSS as <style> elements, which style-src \'self\' blocks: why every index.html using it carries the tag (drawer-csp.test.tsx)', async () => {
    render(
      <Drawer open onOpenChange={() => {}} title="Scan">
        <p>Pages</p>
      </Drawer>,
    )
    await settle()
    expect([...document.querySelectorAll('style')].some((st) => st.textContent?.startsWith('@layer ui-sdk'))).toBe(true)
  })
})
