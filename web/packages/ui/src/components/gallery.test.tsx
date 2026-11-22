import { act, useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { button, cleanup, render, settle } from '../test/ui-sdk.ts'
import { Gallery, type GalleryItem } from './gallery.tsx'

afterEach(() => cleanup())

const items: GalleryItem[] = [
  { id: 'back', label: 'Back', page: <span>back page</span>, thumb: <span>b</span> },
  { id: 'front', label: 'Front', page: <span>front page</span>, thumb: <span>f</span> },
]

function Pages({ onPage }: { onPage: (p: number) => void }) {
  const [page, setPage] = useState(1)
  return (
    <Gallery
      label="ID card"
      items={items}
      page={page}
      onPageChange={(p) => {
        setPage(p)
        onPage(p)
      }}
    />
  )
}

describe('Gallery', () => {
  it('names the pages, marks the shown thumbnail, and shows another page when its thumbnail is pressed', async () => {
    const pages: number[] = []
    render(<Pages onPage={(p) => pages.push(p)} />)
    await settle()
    const carousels = [...document.querySelectorAll('[data-slot="carousel"]')].map((c) => c.getAttribute('aria-label'))
    expect(carousels).toEqual(['ID card', 'Pages'])
    expect(button('Back').getAttribute('aria-pressed')).toBe('true')
    expect(button('Front').getAttribute('aria-pressed')).toBe('false')
    act(() => button('Front').click())
    await settle()
    expect(pages).toEqual([2])
    expect(button('Front').getAttribute('aria-pressed')).toBe('true')
    expect(button('Back').getAttribute('aria-pressed')).toBe('false')
  })

  it('has no strip for a single page', async () => {
    render(<Gallery label="Passport" items={items.slice(0, 1)} page={1} onPageChange={() => {}} />)
    await settle()
    expect(document.querySelectorAll('[data-slot="carousel"]').length).toBe(1)
  })
})
