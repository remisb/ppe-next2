/** The Account page, and the password rules it shares with Users. */
export const account = {
  title: 'Account',
  signedInAs: (name: string) => `Signed in as ${name}.`,
  changePassword: 'Change password',
  changing: 'Changing…',
  passwordChanged: 'Password changed',
  useNewPassword: 'Use the new password the next time you sign in.',
  currentPassword: 'Current password',
  newPassword: 'New password',
  confirmNewPassword: 'Confirm new password',
  atLeast: (n: number) => `At least ${n} characters.`,
  currentIncorrect: 'The current password is incorrect.',
  useAtLeast: (n: number) => `Use at least ${n} characters.`,
  tooLong: 'That password is too long.',
  enterCurrent: 'Enter your current password.',
  chooseDifferent: 'Choose a password different from the current one.',
  noMatch: 'The passwords do not match.',
  language: 'Language',
  languageHint: 'Saved on your account, so every device you sign in on uses it. An employee’s confirmation page keeps its own English / Russian choice, and the signed record stays in English and Russian.',
  languageFailed: 'The language was not changed',
  tableRows: 'Table rows',
  comfortable: 'Comfortable',
  compact: 'Compact',
  densityHint: 'Compact fits more rows on the screen. It is kept for you on this device; ⌘K finds it too.',
  signOut: 'Sign out',
}

export type AccountText = typeof account
