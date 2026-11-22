/** The app's frame: its name, navigation and sign-in. */
const shell = {
  appName: 'Scan Documents',
  signInTagline: 'Part of Workwear & Equipment.',
  mainNav: 'Main',
  scans: 'Scans',
  employees: 'Employees',
  notForYouTitle: 'Scan Documents is not for your role',
  notForYou: 'It is for Personnel Documents. Ask an administrator if you need it.',
  backToWorkwear: 'Back to Workwear',
  signOut: 'Sign out',
}

const kinds = { passport: 'Passport', id_card: 'ID card', residence_permit: 'Residence permit' }

/** Scans: the home, the user's kept scans as a photo grid. */
const scans = {
  title: 'Scans',
  summary: (n: number, open: number) => `${n} ${n === 1 ? 'scan' : 'scans'} · ${open} not saved yet`,
  filters: { label: 'Show', all: 'All', open: 'Not saved', saved: 'Saved' },
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
  count: (n: number) => (n === 1 ? '1 scan' : `${n} scans`),
  badge: { saved: 'Saved', open: 'Not saved', unread: 'MRZ not read' },
  empty: 'No scans in the last 3 days.',
  emptyHint: 'Scan a passport or an ID card: it is read, the person found, and the document filed.',
  kept: 'Scans are kept 3 days for you alone, then deleted. A saved document stays in the person’s personnel file.',
  scanDocument: 'Scan Document',
  opening: 'Opening the scan…',
}

/** The camera, full screen. */
const camera = {
  title: 'Camera',
  close: 'Close',
  auto: 'Auto',
  autoHint: 'Takes the photo once two frames read the same MRZ',
  torch: 'Torch',
  modes: 'Document',
  card: 'ID card',
  passport: 'Passport',
  looking: (card: boolean): string => (card ? 'Hold the card inside the frame' : 'Hold the passport’s data page inside the frame'),
  read: 'MRZ read · two frames agree',
  front: 'Now the front: tap the shutter',
  sides: { back: 'Back · MRZ', front: 'Front · photo' },
  taken: (n: number) => (n === 1 ? '1 photo' : `${n} photos`),
  review: 'Review',
  shutter: 'Take Photo',
  photos: 'Photos',
  making: (n: number) => `Making ${n === 1 ? 'the page' : `${n} pages`}…`,
  keeping: 'Keeping the scan…',
  denied: 'The camera is not allowed. Allow it in the browser’s or the phone’s settings, or choose photos.',
  failed: 'The camera could not start. Choose photos instead.',
  tryAgain: 'Try Again',
  failedPages: 'The pages could not be made. Try again, or choose other photos.',
}

/** Details: the page and what was read. */
const details = {
  back: 'Scans',
  adjust: 'Adjust Corners',
  pages: 'Pages',
  readOk: 'MRZ read and checked',
  readOkDetail: 'Its check digits are right. The MRZ has no accents: check the names against the document.',
  notRead: 'The MRZ could not be read',
  notReadDetail: 'Take the photo again, or type the MRZ from the document.',
  problems: 'The MRZ does not check out',
  problemsDetail: 'A check digit is wrong. Take the photo again, or correct the MRZ.',
  retake: 'Retake',
  typeMrz: 'Type the MRZ',
  person: 'Person',
  document: 'Document',
  surname: 'Surname',
  givenNames: 'Given names',
  birth: 'Birth date',
  sex: 'Sex',
  nationality: 'Nationality',
  personalCode: 'Personal code',
  kind: 'Kind',
  number: 'Number',
  validUntil: 'Valid until',
  issuedOn: 'Issued on',
  issuedBy: 'Issued by',
  placeOfBirth: 'Place of birth',
  optional: 'Optional',
  mrz: 'MRZ',
  mrzHint: 'Two or three lines, as printed at the foot of the page.',
  applyMrz: 'Read These Lines',
  sources: { mrz: 'MRZ', printed: 'Printed', agrees: 'MRZ agrees · check the letters', differs: 'Not the MRZ’s name', typed: 'Typed' },
  readingPrint: 'Reading the printed text…',
  asPrinted: 'As printed on the document',
  printedAlt: 'The names as printed on the document',
  namesChecked: 'I have compared the names with the document.',
  namesHint: 'Add the accents the document prints: the MRZ leaves them out.',
  findEmployee: 'Find Employee',
  blockers: {
    no_mrz: 'Retake or type the MRZ first: saving needs it.',
    problems: 'Correct the MRZ first: a check digit is wrong.',
    surname: 'Type the surname.',
    names: 'Compare the names with the document, and tick that you have.',
    issued_on: 'The date of issue is after the expiry date.',
  },
  download: 'Download Archive',
  downloadHint: 'The pages as one zip, named after the person and the kind.',
  downloaded: (name: string) => `${name} downloaded`,
  remove: 'Delete Scan',
  removeTitle: 'Delete this scan?',
  removeHint: 'Its photos are deleted from Scans. A document already saved stays in the personnel file.',
  removed: 'Scan deleted',
  saved: 'Saved to the personnel file',
  savedHint: 'This scan is kept here 3 days, read only.',
  openEmployee: 'Open Employee Page',
  pageAlt: (side: string) => `The document’s ${side}`,
  sides: { page: 'data page', front: 'front', back: 'back' },
  sexes: { M: 'Male', F: 'Female', X: 'Unspecified' } as Record<string, string>,
  working: 'Keeping the scan…',
}

/** Find Employee. */
const find = {
  title: 'Find Employee',
  back: 'Details',
  searching: 'Looking for the person…',
  mayBe: 'This person may already be an employee',
  one: 'One record is like the document.',
  several: (n: number) => `${n} records are like the document.`,
  noOne: 'No employee is like this person',
  noOneHint: 'Nobody on file has this name, personal code or document number.',
  kinds: { personal_code: 'Personal code', document_number: 'Document number', same_name: 'Same name', similar_name: 'Similar name' },
  rows: { name: 'Name', birth: 'Birth date', nationality: 'Nationality', sex: 'Sex', holds: 'Holds' },
  holds: (orders: number, assets: number) =>
    `${orders === 1 ? '1 order' : `${orders} orders`} · ${assets === 0 ? 'no company assets' : assets === 1 ? '1 company asset' : `${assets} company assets`}`,
  notOnFile: 'not on file',
  marks: { same: 'the same', accents: 'the same but for accents', differs: 'differs', none: 'not on file' },
  noCode: 'No code',
  code: (c: string) => `Code ${c}`,
  hasDocuments: 'Has identity documents',
  useThis: 'Use This Employee',
  pair: (a: string, b: string) => `${a} and ${b} may be one person`,
  pairHint: 'Merge them first, so the document goes to one record. The orders and company assets move to the one you keep.',
  merge: 'Merge Employees…',
  notSame: 'Not the Same Person',
  notSameDone: 'Marked as not the same person.',
  askManager: 'A manager can merge them on Employees. You can still save the document to one of them.',
  bothHaveDocuments: 'Both have identity documents, so they cannot be merged here.',
  chooseAnother: 'Choose Another Employee…',
  searchLabel: 'Name or code',
  noMatch: 'No employee matches.',
  addNew: 'Add as New Employee',
}

/** Update Employee. */
const update = {
  title: 'Update Employee',
  back: 'Back',
  addToRecord: 'Add to Employee Record',
  addOn: (kind: string) => `The employee page’s Identity section shows this ${kind}, and the fields ticked below go onto the record.`,
  addOff: 'The document is filed only. The employee page shows only until when it is valid.',
  take: (kind: string) => `Take from the ${kind}`,
  ticksHint: 'Ticked at first: what the record lacks, and a name that differs only by accents. A real difference starts unticked.',
  fields: { names: 'Name', birth_date: 'Birth date', nationality: 'Nationality', sex: 'Sex' },
  why: { not_on_file: 'Not on file', accents: 'Accents added', differs: 'Differs' },
  empty: 'empty',
  already: 'Already the same',
  nothing: 'The record already has everything the document gives.',
  copies: 'Document Copies',
  copiesHint: 'Kept sealed in the personnel file, drawn again without the camera’s data. Opening one needs Show Document.',
  save: 'Save Document',
  saveAndUpdate: 'Save Document and Update',
  saving: 'Saving…',
  merged: (name: string) => `Merged: ${name}’s orders and company assets moved here.`,
  notShown: 'not shown to you',
}

/** Merge Employees. */
const merge = {
  title: 'Merge Employees',
  cancel: 'Cancel',
  intro: 'Choose the record to keep and, row by row, the value it keeps. The other record’s orders, company assets and photos move to it, and it is removed.',
  keepRecord: 'Keep record',
  keep: 'Keep',
  remove: 'Remove',
  cannotRemove: 'Has identity documents: it can only be kept.',
  rows: { name: 'Name', code: 'Code', language: 'Language' },
  documentSays: (v: string) => `Document: ${v}`,
  empty: 'empty',
  moves: (orders: number, assignments: number, photos: number, name: string) =>
    `${orders === 1 ? '1 order' : `${orders} orders`}, ${assignments === 1 ? '1 company asset' : `${assignments} company assets`} and ${photos === 1 ? '1 photo' : `${photos} photos`} move to ${name}.`,
  confirmTitle: (remove: string, keep: string) => `Merge ${remove} into ${keep}?`,
  confirmHint: (remove: string) => `This cannot be undone. ${remove}’s record is removed and points to the one kept.`,
  action: 'Merge Employees',
  loading: 'Reading both records…',
  languages: { en: 'English', lt: 'Lithuanian', ru: 'Russian' } as Record<string, string>,
}

/** Add New Employee. */
const newEmployee = {
  title: 'Add New Employee',
  back: 'Back',
  from: (kind: string) => `From the ${kind}`,
  fromHint: 'Check the names: type them as the document prints them, with their accents.',
  firstName: 'First name',
  lastName: 'Last name',
  code: 'Code',
  optional: 'Optional',
  addOn: (kind: string) => `Birth date, sex and nationality go onto the new record, and its Identity section shows this ${kind}.`,
  addOff: 'Only the name goes onto the new record; the document is filed.',
  save: 'Add Employee and Save Document',
}

/** Saved. */
const saved = {
  title: 'Saved',
  savedTo: (kind: string, name: string) => `${kind} saved to ${name}’s personnel file.`,
  copies: 'Document Copies',
  copiesOf: (sides: string) => `${sides}, sealed`,
  created: 'New employee added',
  record: 'Employee record',
  updated: (fields: string) => `Updated: ${fields}`,
  notChanged: 'Not changed',
  merged: 'Merged',
  mergedOf: (name: string) => `${name}’s record joined this one`,
  audit: 'Recorded on the audit log. This scan stays in Scans for 3 days.',
  scanNext: 'Scan Next Document',
  openEmployee: 'Open Employee Page',
  backToScans: 'Back to Scans',
}

/** Adjust Corners. */
const adjust = {
  title: 'Adjust Corners',
  hint: 'Drag each corner onto the document’s corner, or move it with the arrow keys. The page is flattened again from them.',
  cancel: 'Cancel',
  done: 'Done',
  photoAlt: 'The photo the page was made from',
  cornerNames: ['Top left corner', 'Top right corner', 'Bottom right corner', 'Bottom left corner'],
  notHere: 'Only a scan taken on this device can have its corners adjusted.',
  working: 'Making the page again…',
}

/** The API's refusals, in words. */
const problems = {
  documentOnFile: 'This document is already on file.',
  otherEmployee: 'This personal code is on another employee’s file.',
  scanGone: 'This scan is no longer kept: it expired or was deleted.',
}

export const en = { shell, kinds, scans, camera, details, find, update, merge, newEmployee, saved, adjust, problems }
