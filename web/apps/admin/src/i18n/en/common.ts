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
  // A primary's shorter words on a phone (+ Add), where the screen's title needs the room.
  add: 'Add',
  active: 'Active',
  inactive: 'Inactive',
}

export type CommonText = typeof common
