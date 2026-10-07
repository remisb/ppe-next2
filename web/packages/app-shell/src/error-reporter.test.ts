import type { ClientErrorReport } from '@ppe/api-client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MAX_REPORTS, reportErrors, reportOf } from './error-reporter.ts'

describe('reportOf', () => {
  it('reports the app\'s errors with their stack', () => {
    const err = new TypeError('x is undefined')
    const r = reportOf(err, '', '/orders')
    expect(r?.message).toBe('TypeError: x is undefined')
    expect(r?.path).toBe('/orders')
    expect(r?.stack).toContain('x is undefined')
  })

  it('leaves out what is not the app\'s', () => {
    expect(reportOf(null, 'Script error.', '/')).toBeNull()
    const ext = new Error('boom')
    ext.stack = 'Error: boom\n    at chrome-extension://abc/content.js:1:1'
    expect(reportOf(ext, '', '/')).toBeNull()
    expect(reportOf(new DOMException('cancelled', 'AbortError'), '', '/')).toBeNull()
  })
})

describe('reportErrors', () => {
  let stop = () => {}
  afterEach(() => stop())

  it('sends each message once, at most MAX_REPORTS a page', () => {
    const send = vi.fn(async (_r: ClientErrorReport) => {})
    stop = reportErrors(send)
    const fire = (msg: string) => window.dispatchEvent(new ErrorEvent('error', { error: new Error(msg), message: msg }))
    fire('one')
    fire('one')
    for (let i = 0; i < 20; i++) fire(`n${i}`)
    expect(send).toHaveBeenCalledTimes(MAX_REPORTS)
    expect(send.mock.calls[0]![0]).toMatchObject({ message: 'Error: one' })
  })
})
