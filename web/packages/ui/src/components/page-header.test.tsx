import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { SortColumn } from '../lib/sort.ts'
import { DropdownMenuItem } from './dropdown-menu.tsx'
import { PageHeader, type ToolbarAction, moreShownBelow, overflowItems } from './page-header.tsx'
import { sortLabel } from './sortable.tsx'

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

const previewPdf: ToolbarAction = { label: 'Preview PDF', showFrom: 'md' }
const exportCsv: ToolbarAction = { label: 'Export', showFrom: 'lg' }
const addSim: ToolbarAction = { label: 'Add SIM' }

describe('the toolbar overflow', () => {
  it('moves into ⋯ only what has a width, in the toolbar order', () => {
    expect(overflowItems([previewPdf, exportCsv, addSim]).map((a) => a.label)).toEqual(['Preview PDF', 'Export'])
    expect(overflowItems([addSim, { label: 'Refresh', showFrom: 'always' }])).toEqual([])
  })

  it('shows ⋯ below the widest width it holds something at, and never empty', () => {
    expect(moreShownBelow([addSim], false)).toBeNull()
    expect(moreShownBelow([previewPdf, addSim], false)).toBe('md')
    expect(moreShownBelow([previewPdf, exportCsv], false)).toBe('lg')
    expect(moreShownBelow([{ label: 'Pictures', showFrom: 'never' }], false)).toBe('always')
    // A screen's rare actions are always under ⋯.
    expect(moreShownBelow([addSim], true)).toBe('always')
  })

  it('draws the controls in slot order: Filters, Refresh, secondary, menu, primary, ⋯', () => {
    const header = render(
      <PageHeader
        title="SIM Cards"
        primary={addSim}
        menu={<button type="button">Menu</button>}
        secondary={[previewPdf]}
        refresh={<button type="button">Refresh</button>}
        filters={{ label: 'Filters', count: 2, controls: 'f', open: false, onToggle: () => {} }}
        more={<DropdownMenuItem>Pictures</DropdownMenuItem>}
      />,
    )
    const names = [...header.querySelectorAll('[data-slot=page-header] button, [data-slot=page-header] a')].map(
      (b) => b.getAttribute('aria-label') ?? b.textContent?.trim(),
    )
    expect(names).toEqual(['Filters (2)', 'Refresh', 'Preview PDF', 'Menu', 'Add SIM', 'More actions for SIM Cards'])
    // One row: the title is the only heading, and nothing under it unless there is a subtitle.
    expect(header.querySelectorAll('h1')).toHaveLength(1)
    expect(header.querySelector('p')).toBeNull()
  })

  it('keeps a phone-width button out of ⋯ on wider screens and the other way round', () => {
    const header = render(<PageHeader title="SIM Cards" secondary={[previewPdf]} primary={addSim} />)
    const pdf = [...header.querySelectorAll('button')].find((b) => b.textContent?.includes('Preview PDF'))!
    expect(pdf.className).toContain('max-md:hidden')
    expect(header.querySelector('[aria-label="More actions for SIM Cards"]')!.className).toContain('md:hidden')
  })

  it('has no ⋯ where it would be empty', () => {
    const header = render(<PageHeader title="Employees" primary={{ label: 'Add New Employee' }} />)
    expect(header.querySelector('[aria-label^="More actions"]')).toBeNull()
  })
})

describe('Sort ▾', () => {
  const columns: SortColumn<'date' | 'employee' | 'status'>[] = [
    { key: 'date', label: 'Date', kind: 'date', firstDir: 'desc' },
    { key: 'employee', label: 'Employee', kind: 'text' },
    { key: 'status', label: 'Status' },
  ]

  it('says the order in words', () => {
    expect(sortLabel(columns, { key: 'date', dir: 'desc' })).toBe('Date, newest first')
    expect(sortLabel(columns, { key: 'employee', dir: 'asc' })).toBe('Employee, A–Z')
    // A column without words of its own says its name alone; its arrow tells the direction.
    expect(sortLabel(columns, { key: 'status', dir: 'desc' })).toBe('Status')
    expect(sortLabel(columns, null, 'Newest first')).toBe('Newest first')
    expect(sortLabel(columns, null)).toBe('Default order')
  })
})
