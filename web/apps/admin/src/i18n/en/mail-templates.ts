import type { MailTemplateKey } from '@ppe/api-client'

/** Mail Templates: the emails the app prepares, each a template with fields. */
export const mailTemplates = {
  title: 'Mail Templates',
  description:
    'The emails the app prepares for staff to copy into their own e-mail; nothing is sent from the app. Each has a template, with fields such as {{sim.number}} that are filled in when the email is prepared.',
  names: { 'sim.activation': 'SIM activation', 'sim.blocking': 'SIM blocking' } satisfies Record<MailTemplateKey, string>,
  usedBy: {
    'sim.activation': 'Prepare Activation Email, on a SIM card that is not Active.',
    'sim.blocking': 'Prepare Blocking Email, on a SIM card that is not Blocked, and after Mark as Not Returned.',
  } satisfies Record<MailTemplateKey, string>,
  isDefault: 'Default text',
  changed: 'Changed',
  open: (name: string) => `Edit ${name}`,
  back: 'Mail Templates',
  to: 'To',
  toHint: 'Usually {{provider.email}}; or type an address.',
  cc: 'Cc',
  ccHint: 'Who gets a copy, such as {{user.email}}, or addresses separated by commas. Leave it empty for no one.',
  subject: 'Subject',
  message: 'Message',
  fields: 'Fields',
  fieldsIntro: 'Click a field to put it where the cursor is.',
  insert: (label: string) => `Insert ${label}`,
  unknownField: (key: string) => `{{${key}}} is not a field of this template.`,
  preview: 'Preview',
  previewIntro: 'With sample values. A field without a value shows in brackets, such as [Phone Number], for staff to fill in.',
  previewing: 'Updating…',
  problems: {
    required: 'This is required.',
    oneLine: 'Keep it on one line.',
  },
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved. The next email prepared uses it.',
  discard: 'Discard changes',
  useDefault: 'Use Default Text',
  useDefaultHint: 'Puts the default text in the form; Save keeps it.',
  unsaved: 'Changes not saved yet.',
  notFound: 'No such mail template',
  /** Each field's description, by key. */
  fieldText: {
    'sim.number': 'The card’s SIM number.',
    'sim.phone_number': 'The card’s phone number.',
    'sim.inventory_number': 'The card’s inventory number, such as SIM-000001.',
    'sim.plan': 'The card’s plan.',
    'provider.name': 'The card’s provider.',
    'provider.email': 'The provider’s e-mail, on Settings.',
    'employee.name': 'Who holds the card; empty when no one does.',
    'company.name': 'The company’s name, on Settings.',
    'user.name': 'Your name: whoever prepares the email.',
    'user.email': 'Your e-mail: whoever prepares the email.',
    today: 'The day the email is prepared.',
  } as Record<string, string>,
}

export type MailTemplatesText = typeof mailTemplates
