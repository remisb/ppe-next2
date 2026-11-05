import type { IdentityDocument } from '@ppe/api-client'

import { copiesInOrder, expired, validityLines, visibleDocuments } from './identity'

const doc = (over: Partial<IdentityDocument>): IdentityDocument => ({
  id: 'd',
  employee_id: 'e',
  kind: 'passport',
  issuing_state: 'LTU',
  issued_on: null,
  expires_on: '2031-05-15',
  on_employee_record: false,
  copies: ['page'],
  superseded_at: null,
  created_at: '2026-11-05T10:00:00Z',
  created_by_user_id: 'u',
  ...over,
})

describe('Identity section', () => {
  it('reads validity, the soonest first, expired ones marked', () => {
    const lines = validityLines(
      [
        { kind: 'passport', issuing_state: 'LTU', expires_on: '2031-05-15' },
        { kind: 'id_card', issuing_state: 'LTU', expires_on: '2025-01-01' },
      ],
      '2026-11-05',
    )
    expect(lines.map((l) => [l.kind, l.expired])).toEqual([
      ['id_card', true],
      ['passport', false],
    ])
    expect(expired('2026-11-05', '2026-11-05')).toBe(false)
  })

  it('lists to readers only what a scan added to the employee record (D11)', () => {
    const filed = doc({ id: 'a' })
    const added = doc({ id: 'b', on_employee_record: true })
    expect(visibleDocuments([filed, added], false).map((d) => d.id)).toEqual(['b'])
    expect(visibleDocuments([filed, added], true).map((d) => d.id)).toEqual(['a', 'b'])
  })

  it('turns a document over in order', () => {
    expect(copiesInOrder(['portrait', 'back', 'front'])).toEqual(['front', 'back', 'portrait'])
  })
})
