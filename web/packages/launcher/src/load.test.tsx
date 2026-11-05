import type { Client, LauncherList } from '@ppe/api-client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { tile } from './testing.ts'

// The signed-in user, as @ppe/app-shell's useApi would give it.
const api = vi.hoisted(() => ({ value: { client: null as unknown, session: null as { userId: string } | null } }))
vi.mock('@ppe/app-shell', () => ({ useApi: () => api.value }))

const { useLauncher } = await import('./load.ts')

// React warns unless it is told this is a test environment for act().
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Pins() {
  const { list } = useLauncher()
  return <p>{list ? list.pins.join(',') : 'loading'}</p>
}

const listOf = (pins: string[]): LauncherList => ({ apps: [tile('workwear'), tile('admin')], pins, preview: false, channels: {}, choices: {} })

let unmount = () => {}
afterEach(() => unmount())

describe('useLauncher', () => {
  it("never gives one user the previous user's list", async () => {
    let second: (l: LauncherList) => void = () => {}
    const get = vi
      .fn()
      .mockResolvedValueOnce(listOf(['admin']))
      .mockReturnValueOnce(new Promise<LauncherList>((resolve) => (second = resolve)))
    const client = { launcher: { get } } as unknown as Client
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)
    unmount = () => {
      act(() => root.unmount())
      container.remove()
    }
    const signIn = async (userId: string) => {
      api.value = { client, session: { userId } }
      await act(async () => root.render(<Pins />))
    }

    await signIn('switch-a')
    expect(container.textContent).toBe('admin')
    // B signs in on the same page (signing out does not reload it): A's list is not B's.
    await signIn('switch-b')
    expect(container.textContent).toBe('loading')
    await act(async () => second(listOf(['workwear'])))
    expect(container.textContent).toBe('workwear')
    expect(get).toHaveBeenCalledTimes(2)
  })
})
