import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { IssueBadge, issueLabel } from './issue-badge.tsx'
import { HelpBody, InControl } from './tooltip.tsx'

// React warns unless it is told this is a test environment for act().
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let unmount = () => {}

function render(node: ReactNode) {
  const container = document.body.appendChild(document.createElement('div'))
  const root = createRoot(container)
  act(() => root.render(node))
  unmount = () => {
    act(() => root.unmount())
    container.remove()
  }
  return container
}

afterEach(() => unmount())

const two = [
  { title: 'Price is missing.', detail: 'Set it in Edit Item.' },
  { title: 'Service period is missing.', detail: 'Set it in Edit Item.' },
]

describe('issueLabel', () => {
  it('counts the issues only when there are several', () => {
    expect(issueLabel('Inactive', 1)).toBe('Inactive')
    expect(issueLabel('Incomplete', 3)).toBe('Incomplete (3)')
  })
})

describe('IssueBadge', () => {
  it('is a plain badge without issues', () => {
    const c = render(<IssueBadge label="Active" issues={[]} />)
    expect(c.querySelector('[data-slot=badge]')?.textContent).toBe('Active')
    expect(c.querySelector('button')).toBeNull()
  })

  it('in a page, is a button that counts its issues and describes them', () => {
    const c = render(<IssueBadge label="Incomplete" variant="warning" issues={two} note="It cannot be ordered." />)
    const button = c.querySelector('button')!
    expect(button.textContent).toBe('Incomplete (2)')
    const description = document.getElementById(button.getAttribute('aria-describedby')!)
    expect(description?.textContent).toBe('Price is missing. Set it in Edit Item. Service period is missing. Set it in Edit Item. It cannot be ordered.')
  })

  it('inside a control (a list row), is a badge with a tooltip, not a button', () => {
    const c = render(
      <InControl value>
        <IssueBadge label="Inactive" issues={['Not offered in Add Item.']} />
      </InControl>,
    )
    expect(c.querySelector('button')).toBeNull()
    // The tooltip's trigger is the badge itself.
    const badge = c.querySelector('[data-slot=tooltip-trigger]')!
    expect(badge.tagName).toBe('SPAN')
    expect(badge.textContent).toBe('Inactive')
    expect(document.getElementById(badge.getAttribute('aria-describedby')!)?.textContent).toBe('Not offered in Add Item.')
  })
})

describe('HelpBody', () => {
  it('numbers a list of one as it numbers several, so their text starts at the same place', () => {
    const one = render(<HelpBody body={['Not offered in Add Item.']} />)
    expect(one.querySelectorAll('ol > li')).toHaveLength(1)
    expect(one.querySelector('li > span')?.textContent).toBe('1')
    unmount()
    const two = render(<HelpBody body={['A.', 'B.']} />)
    expect([...two.querySelectorAll('li > span')].map((s) => s.textContent)).toEqual(['1', '2'])
  })

  it('keeps a string a paragraph (a tab\'s or a tile\'s explanation)', () => {
    const c = render(<HelpBody body="SIMs the provider has switched on." />)
    expect(c.querySelector('ol')).toBeNull()
    expect(c.querySelector('p')?.textContent).toBe('SIMs the provider has switched on.')
  })
})
