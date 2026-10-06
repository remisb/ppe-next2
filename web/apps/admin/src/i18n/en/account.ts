/** Password fields, as Account words them in the staff app. */
export const account = {
  newPassword: 'New password',
  confirmNewPassword: 'Confirm new password',
  atLeast: (n: number) => `At least ${n} characters.`,
  noMatch: 'The passwords do not match.',
}

export type AccountText = typeof account
