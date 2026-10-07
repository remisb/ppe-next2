import type { SignedInDevice } from '@ppe/api-client'
import { describe, expect, it } from 'vitest'

import { deviceLabel, sortDevices } from './devices'

const agents = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  samsungAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
}

describe('deviceLabel', () => {
  it('says the browser on the system, or what is known', () => {
    expect(deviceLabel(agents.chromeWindows)).toBe('Chrome on Windows')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Something/1')).toBe('Windows')
    expect(deviceLabel('curl/8.7.1')).toBe('Unknown browser')
  })
})

describe('sortDevices', () => {
  it('puts this device first and keeps the order of the rest', () => {
    const d = (id: string, current = false) => ({ id, current }) as SignedInDevice
    expect(sortDevices([d('a'), d('b', true), d('c')]).map((x) => x.id)).toEqual(['b', 'a', 'c'])
  })
})
