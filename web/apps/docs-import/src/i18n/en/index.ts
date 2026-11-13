import type { CheckedField, FieldName, NoteCode, ProblemCode } from '@ppe/mrz'

/** The app's frame: its name, navigation and sign-in. */
const shell = {
  appName: 'Import Documents',
  signInTagline: 'Part of Workwear & Equipment.',
  mainNav: 'Main',
  employees: 'Employees',
  notForYouTitle: 'Import Documents is not for your role',
  notForYou: 'Reading identity documents needs the Personnel Documents role. Ask an administrator if you need it.',
  backToWorkwear: 'Back to Workwear & Equipment',
  signOut: 'Sign out',
  importTab: 'Import to Personnel',
  scanTab: 'Scan Document',
}

/** The steps, in order. */
const steps = {
  label: 'Steps',
  person: 'Person',
  capture: 'Document',
  review: 'Review',
  portrait: 'Portrait',
  done: 'Saved',
}

/** Step 1: whose document it is. */
const person = {
  title: 'Whose document is it?',
  description: 'Choose the employee, or make a new one from the document.',
  search: 'Find an employee',
  searchHint: 'First or last name, or code.',
  noMatch: 'No employee matches.',
  choose: 'Choose',
  newEmployee: 'New Employee from Document',
  newEmployeeHint: 'The names on the document make the employee.',
  chosen: 'For',
  newChosen: 'A new employee, from the document',
  change: 'Change',
}

/** Step 2: the photos. */
const capture = {
  title: 'Photograph the document',
  description: 'The photo needs the whole page or card, flat, without glare on the lines of letters and < at the bottom.',
  passport: 'Passport',
  card: 'ID card or residence permit',
  typeLabel: 'Document',
  page: "Passport's photo page",
  back: 'Back, with the code lines',
  front: 'Front, with the photo',
  takePhoto: 'Take Photo',
  choosePhoto: 'Choose Photo',
  reading: 'Reading the document…',
  readerFailed: 'The reader could not start. Check the connection and try again.',
  found: 'Code lines found.',
  agreedNote: 'Read twice, the same both times.',
  notAgreed: 'Read, but not the same twice: compare it with the document on the next step.',
  noMrz: 'No code lines found on this photo.',
  frontOnly: 'This is the front. Photograph the back too, with the code lines.',
  typeInstead: 'Type the Lines Instead',
  liveCamera: 'Camera',
  stopCamera: 'Stop Camera',
  liveLabel: 'The camera’s picture',
  aim: (type: 'passport' | 'card'): string =>
    type === 'passport'
      ? 'Hold the photo page inside the frame, its code lines in the band at the bottom.'
      : 'Hold the back inside the frame, its code lines in the band at the bottom.',
  liveRead: 'Read the same in two frames. For a card, now Take Picture of its front.',
  takePicture: 'Take Picture',
  cameraDenied: 'The camera was not allowed. Allow it in the browser, or take photos instead.',
  cameraUnavailable: 'The camera could not start. Take photos instead.',
  continue: 'Review',
}

/** Step 3: the review (FR-7, FR-8). */
const review = {
  title: 'Check what was read',
  description: 'The code lines decide the number and dates. Type the names as printed, with their letters (Ž, Ė…).',
  lines: 'Code lines (MRZ)',
  linesHint: 'Two or three lines of capitals, digits and <. Change a character, and the fields below follow.',
  checked: 'I have compared the code lines with the document.',
  checkedHint: 'Needed when the two readings differed or a number was corrected.',
  fields: 'Read from the code lines',
  kind: 'Kind',
  number: 'Number',
  issuingState: 'Issued by',
  nationality: 'Nationality',
  birthDate: 'Date of birth',
  sex: 'Sex',
  expiresOn: 'Expires on',
  personalCode: 'Personal code',
  corrected: 'Corrected',
  names: 'Names, as printed',
  surname: 'Surname',
  givenNames: 'Given names',
  namesDiffer: "The names differ from the document's code: check them.",
  namesTruncated: 'The code shortened the names; the printed ones are kept.',
  optional: 'Not in the code lines (optional)',
  issuedOn: 'Issued on',
  placeOfBirth: 'Place of Birth',
  authority: 'Issuing Authority',
  addToRecord: 'Add to Employee Record',
  addToRecordHint: 'Off: the document is filed in Personnel files only. On: the employee page shows it, and you may take its details below.',
  differences: 'Different from the employee on file',
  takeLabel: (field: string) => `Take ${field}`,
  current: 'On file',
  document: 'Document',
  none: 'none',
  checking: 'Checking with the register…',
  next: 'Next: Portrait',
  save: 'Save Document',
  saving: 'Saving…',
  back: 'Back',
  photos: 'Photos',
}

/** Step 4: the portrait (FR-11, FR-13). */
const portrait = {
  title: 'The portrait',
  description: 'The photo on the document, cut out. Move the box over the face and size it to the head and shoulders.',
  keep: 'Keep the portrait',
  keepHint: "Kept with the document's copies, sealed.",
  asPhoto: "Also make it the employee's photo",
  asPhotoHint: 'Added to their Photos, seen by everyone who opens the employee; the first photo becomes their picture.',
  documentAlt: 'The document, with the portrait’s box',
  cropLabel: 'Portrait box',
  cropHint: 'Drag the box to move it and its corner to size it; with the keyboard, the arrows move it and + and − size it.',
  larger: 'Larger',
  smaller: 'Smaller',
  loading: 'Opening the picture…',
  noPicture: (type: 'passport' | 'card'): string =>
    type === 'passport' ? 'No picture of the photo page: saved without a portrait.' : "No picture of the card's front: saved without a portrait.",
}

/** Make Colour Photo (AI), on the portrait step (FR-12, PR-6, PR-7). */
const colour = {
  title: 'Colour photo (AI)',
  hint: 'OpenAI colours the grey portrait, without the name; every line of the face stays the document’s. Only with the person’s consent.',
  consent: 'The person agrees',
  consents: { verbal: 'Verbally, here and now', written: 'In writing' },
  given: { verbal: 'verbal', written: 'written' },
  consentHint: 'They may refuse: then the grey portrait is used.',
  make: 'Make Colour Photo (AI)',
  making: 'Colouring…',
  before: 'Document',
  beforeAlt: 'The grey portrait from the document',
  afterAlt: 'The AI-coloured photo',
  label: 'AI-coloured',
  guess: 'The colours are a guess: eyes, hair and skin may be wrong.',
  use: 'Use',
  again: 'Try Again',
  discard: 'Discard',
  chosen: (how: string): string => `Saved as the employee’s photo, marked AI-coloured. Consent: ${how}.`,
  dontUse: 'Don’t use it',
}

/** What stops Save, said on the review. */
const blockers = {
  no_mrz: 'Type the code lines from the document.',
  problems: 'Put right what the code lines say is wrong.',
  surname: 'Type the surname.',
  given_names: 'Type the given names: they make the new employee.',
  issued_on: 'The date of issue must be a date before the expiry date.',
  not_checked: 'Compare the code lines with the document, and tick that you have.',
  document_on_file: 'This document is already on file.',
  other_employee: "This personal code is another employee's.",
}

/** An MRZ's problems and notes (@ppe/mrz's codes). */
const problems: Record<ProblemCode, string> = {
  check_digit: "A check digit does not match: a character is misread. Compare it with the document.",
  ambiguous_correction: 'More than one reading fits the check digit. Type the characters from the document.',
  invalid_character: 'A character cannot be there.',
  invalid_date: 'Not a date.',
  invalid_sex: 'Not M, F or <.',
  unknown_state: 'Not a known state code.',
  no_surname: 'There is no surname.',
  names_unreadable: 'The names look misread (fillers read as letters).',
  expiry_before_birth: 'Expires before the date of birth.',
  birth_in_future: 'The date of birth is in the future.',
  unsupported_document: 'Visas are not read here.',
  personal_code_checksum: "The personal code's check digit does not match.",
  personal_code_birth_date: 'The personal code says another date of birth.',
  personal_code_sex: 'The personal code says another sex.',
}

const notes: Record<NoteCode, string> = {
  expired: 'The document has expired. It can still be saved.',
  specimen: 'A specimen document (Utopia).',
  incomplete_date: 'The date of birth is not complete on the document.',
  corrected: 'Corrected from a look-alike character.',
}

/** The MRZ's fields, as problems name them. */
const fieldNames: Record<FieldName | CheckedField, string> = {
  documentCode: 'Document code',
  issuingState: 'Issuing state',
  documentNumber: 'Document number',
  documentNumberCheck: "Document number's check digit",
  optionalData1: 'Optional data',
  birthDate: 'Date of birth',
  birthDateCheck: "Date of birth's check digit",
  sex: 'Sex',
  expiryDate: 'Expiry date',
  expiryDateCheck: "Expiry date's check digit",
  nationality: 'Nationality',
  optionalData2: 'Optional data',
  personalNumber: 'Personal number',
  personalNumberCheck: "Personal number's check digit",
  compositeCheck: 'Final check digit',
  names: 'Names',
  composite: 'Final check digit',
}

const kinds = { passport: 'Passport', id_card: 'ID card', residence_permit: 'Residence permit' }
const sexes = { M: 'Male', F: 'Female', X: 'Unspecified' }
const takes = { names: 'names', birth_date: 'date of birth', nationality: 'nationality', sex: 'sex' }

/** Step 4: saved. */
const done = {
  title: 'Document saved',
  description: (kind: string, state: string, until: string) => `${kind} · ${state} · valid until ${until}`,
  sealed: 'Its number, personal code and copies are sealed in Personnel files.',
  openEmployee: 'Open Employee',
  another: 'Import Another',
}

/** Save's refusals the API names. */
const errors = {
  title: 'Not saved',
  conflictDocument: 'This document is already on file.',
  conflictEmployee: "This personal code is another employee's.",
  notConfigured: 'Personnel files is not set up on this server yet.',
}

/** Scan Document: one person's document photographed page by page, flattened, kept as an archive. */
const scan = {
  title: 'Scan Document',
  description: "Photos of one person's passport or ID card. Each page is turned, its corners found and flattened. Download the pages as one archive, or save the document to Personnel.",
  choosePhotos: 'Choose Photos',
  takePhoto: 'Take Photo',
  photosHint: 'Up to 10 photos: the page with the code lines and any other pages. Sideways and upside-down photos are turned.',
  making: (done: number, all: number) => `Making pages: ${done} of ${all}…`,
  tooMany: 'One archive holds 10 pages. The other photos were left out.',
  detailsTitle: 'Document',
  surname: 'Surname',
  givenNames: 'Given names',
  kind: 'Document type',
  number: 'Document number',
  readAgreed: 'Read from the code lines, the same twice.',
  checkThis: 'Read from the code lines once: compare them with the document.',
  notRead: 'No code lines read yet: type the surname.',
  fileName: 'Archive name',
  pagesTitle: 'Pages',
  pageLabel: (n: number) => `Page ${n}`,
  makingPage: 'Making the page…',
  failed: 'This photo could not be made into a page. Remove it or take it again.',
  checkCorners: 'Check corners',
  checkCornersHint: "The page's edges were hard to find. Adjust Corners if the page is cut off or shows background.",
  codeLines: 'Code lines read',
  turnLeft: 'Turn Left',
  turnRight: 'Turn Right',
  adjustCorners: 'Adjust Corners',
  remove: 'Remove',
  addPhotos: 'Add Photos',
  clear: 'Clear',
  download: 'Download Archive',
  downloading: 'Preparing the archive…',
  saveToPersonnel: 'Save to Personnel',
  keptNote: 'The archive is kept for you in Recent scans for a few days, then deleted.',
  blockers: {
    no_pages: 'Add a photo of the document.',
    working: 'Wait until every page is made.',
    surname: 'Type the surname: it names the archive.',
  },
  recentTitle: 'Recent scans',
  recentHint: 'Your own archives. Each is deleted from the server a few days after it was made.',
  recentEmpty: 'No archives kept.',
  pages: (n: number) => (n === 1 ? '1 page' : `${n} pages`),
  deletedIn: (days: number) => (days <= 1 ? 'Deleted within a day' : `Deleted in ${days} days`),
  downloadAgain: 'Download',
  removeAsk: 'Remove this archive from the server?',
  removeYes: 'Remove',
  cancel: 'Cancel',
  cornersTitle: 'Adjust Corners',
  cornersHint: "Drag each corner to the page's corner. With the keyboard: Tab to a corner, then the arrow keys (Shift moves further).",
  cornerNames: ['Top left corner', 'Top right corner', 'Bottom right corner', 'Bottom left corner'] as [string, string, string, string],
  photoAlt: 'The photo, turned',
  pageAlt: (n: number) => `Page ${n}, flattened`,
  cornersDone: 'Done',
}

export const en = { shell, steps, person, capture, review, portrait, colour, blockers, problems, notes, fieldNames, kinds, sexes, takes, done, errors, scan }
