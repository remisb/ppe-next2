import type { AccountText } from '../en/account'

export const account: AccountText = {
  newPassword: 'Naujas slaptažodis',
  confirmNewPassword: 'Pakartokite naują slaptažodį',
  atLeast: (n: number) => `Ne mažiau kaip ${n} simbolių.`,
  noMatch: 'Slaptažodžiai nesutampa.',
}
