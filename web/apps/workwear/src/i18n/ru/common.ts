import { plural } from '@ppe/i18n'

import type { CommonText } from '../en/common'

export const common: CommonText = {
  appName: 'Спецодежда и снаряжение',
  cancel: 'Отмена',
  save: 'Сохранить',
  saving: 'Сохранение…',
  back: 'Назад',
  edit: 'Изменить',
  delete: 'Удалить',
  add: 'Добавить',
  search: 'Поиск',
  retry: 'Повторить',
  actionFailed: 'Действие не выполнено',
  moreActions: (name: string) => `Другие действия: ${name}`,
  ordered: 'Заказано',
  given: 'Выдано',
  active: 'Активен',
  inactive: 'Неактивен',
  none: 'Нет',
  all: 'Все',
  total: 'Итого',
  months: (n: number) => plural(n, { one: '# месяц', few: '# месяца', many: '# месяцев', other: '# месяца' }),
  days: (n: number) => plural(n, { one: '# день', few: '# дня', many: '# дней', other: '# дня' }),
  items: (n: number) => plural(n, { one: '# предмет', few: '# предмета', many: '# предметов', other: '# предмета' }),
  lines: (n: number) => plural(n, { one: '# строка', few: '# строки', many: '# строк', other: '# строки' }),
  orders: (n: number) => plural(n, { one: '# заказ', few: '# заказа', many: '# заказов', other: '# заказа' }),
  employees: (n: number) => plural(n, { one: '# сотрудник', few: '# сотрудника', many: '# сотрудников', other: '# сотрудника' }),
}
