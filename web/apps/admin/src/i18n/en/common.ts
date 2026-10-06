/** Words several Administration screens share. */
export const common = {
  appName: 'Administration',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  edit: 'Edit',
  view: 'View',
  close: 'Close',
  moreActions: (name: string) => `More actions for ${name}`,
  active: 'Active',
  inactive: 'Inactive',
}

export type CommonText = typeof common
