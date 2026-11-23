import { plural } from '@ppe/i18n'

import type { SharesText } from '../en/shares'

export const shares: SharesText = {
  title: 'Отправленные ссылки',
  description: 'Ссылки, которыми вы поделились и которые ещё действуют. Любой, у кого есть ссылка, может открыть её, пока не истечёт срок; отзовите её, чтобы закрыть сразу.',
  name: 'Название',
  type: 'Тип',
  rows: 'Строки',
  shared: 'Отправлено',
  openUntil: 'Действует до',
  kinds: { employees: 'Сотрудники' },
  revoke: 'Отозвать',
  revokeName: (name: string) => `Отозвать: ${name}`,
  revokeQuestion: (name: string) => `Отозвать ссылку «${name}»? Она сразу перестанет открываться, а данные в ней будут удалены. Это нельзя отменить.`,
  revoked: (name: string) => `Ссылка «${name}» отозвана.`,
  none: 'Действующих ссылок нет',
  noneHelp: 'Поделитесь несколькими сотрудниками в разделе «Сотрудники»: Экспорт (или Поделиться), затем Ссылка для просмотра.',
  openEmployees: 'Открыть сотрудников',
  // The name Share Link proposes for more than three people: the first two, and how many more.
  namesAndMore: (names: string, more: number) => `${names} ${plural(more, { one: 'и ещё #', few: 'и ещё #', many: 'и ещё #', other: 'и ещё #' })}`,
  pageSharedBy: (who: string, when: string) => `Отправил(а) ${who}, ${when}`,
  pageOpenUntil: (when: string) => `Ссылка действует до ${when}.`,
  pageAsOf: 'Данные такие, какими были при отправке.',
  pageGone: 'Ссылка больше не действует',
  pageGoneHelp: 'Её срок истёк или её отозвали. Попросите отправителя прислать новую.',
  pageNotFound: 'Такой ссылки нет',
  pageNotFoundHelp: 'Проверьте, что она скопирована полностью, или попросите новую.',
  pageCount: (n: number) => plural(n, { one: '# человек', few: '# человека', many: '# человек', other: '# человека' }),
}
