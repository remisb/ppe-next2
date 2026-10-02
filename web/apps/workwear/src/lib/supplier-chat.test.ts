import { describe, expect, it } from 'vitest'

import { checkSupplierChat } from './supplier-chat'

describe('checkSupplierChat', () => {
  const link = 'https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv'

  it('takes a name with a group invite link, as WhatsApp copies it too', () => {
    expect(checkSupplierChat('Superman Rubai Group', link)).toEqual({})
    expect(checkSupplierChat(' Superman Rubai Group ', ` ${link}?mode=ems_copy_t `)).toEqual({})
  })

  it('takes both empty, which removes the group', () => {
    expect(checkSupplierChat('', '  ')).toEqual({})
  })

  it('needs both together', () => {
    expect(checkSupplierChat('Superman Rubai Group', '')).toEqual({ link: 'required' })
    expect(checkSupplierChat('', link)).toEqual({ name: 'required' })
  })

  it('refuses anything but a group invite link', () => {
    for (const bad of ['https://wa.me/37060000000', 'https://chat.whatsapp.com/', 'https://chat.whatsapp.com.evil.example/AbCdEfGhIjKl', 'chat.whatsapp.com/AbCdEfGhIjKl', 'javascript:alert(1)']) {
      expect(checkSupplierChat('X', bad), bad).toEqual({ link: 'invalid' })
    }
  })
})
