import { afterEach, expect, it } from 'vitest'

import { cleanup, render, settle } from '../test/ui-sdk.ts'
import { ImageCropper } from './image-cropper.tsx'

afterEach(() => cleanup())

it('is named, holds the picture with its alt text, and has a handle at each corner', async () => {
  render(<ImageCropper label="Portrait" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="The document's portrait" aspectRatio={3 / 4} />)
  await settle()
  const root = document.querySelector('[data-slot="image-cropper"]')!
  expect(root.getAttribute('aria-label')).toBe('Portrait')
  expect(document.querySelector('[data-slot="image-cropper-image"]')?.getAttribute('alt')).toBe("The document's portrait")
  expect([...document.querySelectorAll('[data-slot="image-cropper-handle"]')].map((h) => h.getAttribute('data-position'))).toEqual(['nw', 'ne', 'sw', 'se'])
})
