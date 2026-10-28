import { describe, expect, it } from 'vitest'

import { insertField, sameText, textProblems, tidyText, unknownFields, usedFields } from './mail-templates'

describe('insertField', () => {
  it('puts the field at the cursor and moves the cursor past it', () => {
    expect(insertField('Hello ,', 'employee.name', 6)).toEqual({ text: 'Hello {{employee.name}},', cursor: 23 })
  })

  it('replaces a selection, whichever way it was made', () => {
    expect(insertField('Block X now', 'sim.number', 6, 7)).toEqual({ text: 'Block {{sim.number}} now', cursor: 20 })
    expect(insertField('Block X now', 'sim.number', 7, 6).text).toBe('Block {{sim.number}} now')
  })

  it('keeps a cursor past the end at the end', () => {
    expect(insertField('Hi', 'today', 99).text).toBe('Hi{{today}}')
  })
})

describe('tidyText and sameText', () => {
  it('trims as the server saves', () => {
    expect(tidyText({ to: ' a@b.lt ', cc: ' c@d.lt ', subject: ' S ', body: 'Hello,  \r\n\r\nBye\t\n\n' })).toEqual({
      to: 'a@b.lt',
      cc: 'c@d.lt',
      subject: 'S',
      body: 'Hello,\n\nBye',
    })
  })

  it('tells text that saves the same', () => {
    const t = { to: '{{provider.email}}', cc: '', subject: 'Block', body: 'Hello' }
    expect(sameText(t, { ...t, body: 'Hello\n' })).toBe(true)
    expect(sameText(t, { ...t, body: 'Hello!' })).toBe(false)
    expect(sameText(t, { ...t, cc: '{{user.email}}' })).toBe(false)
  })
})

describe('the fields a template uses', () => {
  const fields = [
    { key: 'sim.number', label: 'SIM Number', sample: '8937' },
    { key: 'provider.email', label: 'Provider E-mail', sample: 'sim@telia.lt' },
  ]
  const t = { to: '{{provider.email}}', cc: '{{user.email}}', subject: 'Block {{ sim.number }}', body: '{{sim.number}} {{sim.nubmer}}' }

  it('lists each once, in order', () => {
    expect(usedFields(t)).toEqual(['provider.email', 'user.email', 'sim.number', 'sim.nubmer'])
  })

  it('finds the ones the template does not have', () => {
    expect(unknownFields(t, fields)).toEqual(['user.email', 'sim.nubmer'])
  })
})

describe('textProblems', () => {
  it('asks for each part, and the recipient and subject on one line', () => {
    expect(textProblems({ to: ' ', cc: 'a\nb', subject: 'A\nB', body: '\n' })).toEqual({ to: 'required', cc: 'oneLine', subject: 'oneLine', body: 'required' })
    // Cc may be empty: no one gets a copy.
    expect(textProblems({ to: 'a', cc: ' ', subject: 'b', body: 'c\nd' })).toEqual({})
  })
})
