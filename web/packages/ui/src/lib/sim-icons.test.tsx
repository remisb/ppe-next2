import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as icons from './sim-icons.ts'

afterEach(() => vi.restoreAllMocks())

describe('SIM icons', () => {
  for (const [name, Icon] of Object.entries(icons)) {
    it(`${name} draws the card and its badge, with no React warning`, () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      const svg = renderToStaticMarkup(createElement(Icon, { 'aria-hidden': true }))
      // The card's outline, open at the bottom right, and its chip, then the badge.
      expect(svg).toContain('M11 22H4a2 2 0 0 1-2-2V4')
      expect(svg).toContain('<rect x="5" y="6" width="8" height="8" rx="2"')
      expect(svg.match(/<(path|rect|circle)/g)!.length).toBeGreaterThan(4)
      // Lucide draws an icon's shapes as one array of children, so each needs a key.
      expect(errors).not.toHaveBeenCalled()
    })
  }
})
