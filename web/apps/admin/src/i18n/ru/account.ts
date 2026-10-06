import type { AccountText } from '../en/account'

export const account: AccountText = {
  newPassword: 'Новый пароль',
  confirmNewPassword: 'Повторите новый пароль',
  atLeast: (n: number) => `Не менее ${n} символов.`,
  noMatch: 'Пароли не совпадают.',
}
