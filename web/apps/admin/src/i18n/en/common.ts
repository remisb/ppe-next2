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
  // Exporting a list (the ExportSheet from @ppe/ui): the screen's button, and the selection bar's.
  export: 'Export',
  exportSelected: 'Export…',
  active: 'Active',
  inactive: 'Inactive',
}

export type CommonText = typeof common
