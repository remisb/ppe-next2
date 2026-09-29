import type { ReactNode } from 'react'

/**
 * Create Order: the composer, its pickers and lines, the review sheet and the
 * success screen; the stored order's lines; Copy for WhatsApp and the
 * supplier message it copies. Sentences with an emphasised value take and
 * return nodes, so the emphasis sits wherever the language puts the value.
 */
export const order = {
  // Create Order screen
  title: 'Create Order',
  description: 'Prepare a supplier order for one employee. Nothing is final until Mark as Ordered.',
  newOrder: 'New order',
  replaceConfirm: (name: string) => `Replace the order in progress for ${name} with this reorder?`,
  noOneYet: 'no one yet',
  setOnOrderConfirm: (set: string) => `${set} is on this order already. Add its items again?`,
  clearConfirm: 'Clear this order? Unsaved lines will be lost.',
  cannotMarkAsOrdered: 'Cannot mark as ordered',
  conflictHelp: (serverMessage: string) =>
    `${serverMessage}. An authorised user must complete or reactivate it in the Item Catalogue, or remove the line.`,
  thatDidNotWork: 'That did not work',
  assignedTo: 'Assigned to',
  savedSizesOf: (name: string) => `Saved sizes of ${name}`,
  addItem: 'Add Item',
  itemSet: 'Item Set',
  /** Visually hidden, before an item set's name on its button. */
  applySr: 'Apply ',
  /** Visually hidden, after the name of an item set already on the order. */
  onThisOrderSr: ' (on this order)',
  noItemSets: 'No item sets yet.',
  chooseEmployeeFirst: 'Choose who the order is for first: sizes are resolved from their saved defaults.',
  dueFor: (firstName: string) => `Due for ${firstName}`,
  addAll: (n: number) => `Add all ${n}`,
  overdueSinceLastGiven: (due: string, lastGiven: string) => `Overdue since ${due} · last given ${lastGiven}`,
  dueLastGiven: (due: string, lastGiven: string) => `Due ${due} · last given ${lastGiven}`,
  checkSizesFor: (name: string) => `Check sizes for ${name}`,
  conflictResolved: (item: string, chosen: ReactNode, resolved: ReactNode): ReactNode[] => [
    item,
    ': you chose ',
    chosen,
    '; resolved size is ',
    resolved,
    '.',
  ],
  conflictNoSaved: (item: string, chosen: ReactNode): ReactNode[] => [item, ': you chose ', chosen, '; this employee has no saved size.'],
  useSize: (size: string) => `Use ${size}`,
  clearSize: 'Clear size',
  removeLine: 'Remove line',
  keepSize: (size: string) => `Keep ${size}`,
  saveAsDefaultQuestion: 'Save as Employee Default?',
  noSavedClothing: (name: string, size: ReactNode): ReactNode[] => [
    `${name} has no saved clothing size. Save `,
    size,
    ' for future orders?',
  ],
  noSavedShoe: (name: string, size: ReactNode): ReactNode[] => [`${name} has no saved shoe size. Save `, size, ' for future orders?'],
  saveAsDefault: 'Save as Employee Default',
  thisOrderOnly: 'This order only',
  resolveHighlighted: 'Resolve the highlighted lines.',
  saveAndSelectEmployee: 'Save and Select Employee',

  // Summary panel and bar
  orderSummary: 'Order summary',
  complete: 'complete',
  notReady: 'not ready',
  working: 'Working…',
  review: 'Review',
  for: 'For',
  lastOrder: 'Last order',
  noEarlierOrders: 'No earlier orders',
  chooseEmployee: 'Choose who the order is for.',
  dueForReplacement: 'Due for replacement',
  itemOverdueSince: (item: string, date: string) => `${item} overdue since ${date}`,
  itemDue: (item: string, date: string) => `${item} due ${date}`,
  onThisOrder: 'on this order',
  reviewAndMark: 'Review and mark as ordered',
  keyAddItem: 'add item',
  keyReview: 'review',
  keyQuantity: 'quantity',

  // Review sheet
  reviewOrder: 'Review order',
  reviewDescription: (who: string) => `For ${who}. After Mark as Ordered this record cannot be changed.`,
  markAsOrdered: 'Mark as Ordered',
  orderLines: 'Order lines',
  createLinkToo: 'Create the confirmation link as well',
  createLinkHint: (firstName: string | null) =>
    `${firstName ?? 'The employee'} confirms receipt with it; you can still print the record for signing instead.`,

  // After Mark as Ordered
  orderIsOrdered: (recordNumber: string) => `Order ${recordNumber} is ordered`,
  preparedBy: (name: string) => `prepared by ${name}`,
  nextGiven: (name: string) => `${name}'s signed paper confirmation is recorded: the order is Given.`,
  nextSendLink: (name: string) =>
    `This record can no longer be edited. Next, send ${name} the confirmation link below, or print the record for signing. It changes to Given when they confirm.`,
  nextConfirm: (name: string) =>
    `This record can no longer be edited. Next, ${name} confirms receipt: send a secure link, or print the record for signing. It changes to Given when they confirm.`,
  employeeConfirmation: 'Employee confirmation',
  linkNotCreated: 'The confirmation link was not created',
  sendConfirmationLink: 'Send confirmation link',
  printRecord: 'Print record',
  startNewOrder: 'Start a new order',

  // Lines
  noItemsYet: 'No items yet. Use Add Item, or choose an Item Set.',
  item: 'Item',
  size: 'Size',
  quantity: 'Quantity',
  unitPrice: 'Unit price',
  servicePeriod: 'Service period',
  remove: 'Remove',
  totalValue: 'Total value',
  unknownItem: 'Unknown item',
  removeItem: (item: string) => `Remove ${item}`,
  noSize: 'No size',
  sizeOf: (item: string) => `Size of ${item}`,
  selectSizeOption: 'Select size…',
  suggestedFromHeight: 'Suggested from height',
  /** Stacked-card labels of a stored order's lines. */
  cardSize: 'Size',
  cardQty: 'Qty',
  cardUnit: 'Unit',
  cardService: 'Service',

  // Validation
  selectEmployee: 'Select an employee in Assigned to.',
  addAtLeastOne: 'Add at least one item.',
  itemUnavailable: 'This item is no longer available. Remove it from the order.',
  quantityInvalid: 'Quantity must be a whole number of at least 1.',
  selectSize: 'Select a size.',
  priceMissing: 'No price or service period in the Item Catalogue. An authorised user must complete it.',

  // The employee's saved sizes
  heightCm: (cm: number) => `${cm} cm`,
  clothingSize: (size: string) => `Clothing ${size}`,
  clothingFromHeight: 'Clothing from height',
  noClothingSize: 'No clothing size',
  shoeSize: (size: string) => `Shoes ${size}`,
  noShoeSize: 'No shoe size',

  // Pickers and quantity
  addAnItem: 'Add an item…',
  items: 'Items',
  noPrice: 'No price',
  noItemMatches: (q: string) => `No item matches “${q}”.`,
  loadingItems: 'Loading items…',
  searchEmployees: 'Search employees…',
  addNewEmployee: '+ Add New Employee',
  allEmployees: 'All employees',
  couldNotSearchEmployees: 'Could not search employees.',
  noMatchingEmployees: 'No matching employees.',
  oneFewer: (item: string) => `One fewer ${item}`,
  oneMore: (item: string) => `One more ${item}`,
  quantityOf: (item: string) => `Quantity of ${item}`,

  // WhatsApp
  copyForWhatsApp: 'Copy for WhatsApp',
  copied: 'Copied.',
  openWhatsApp: 'Open WhatsApp',
  /** "Copying is blocked here. Select the text below, or [open WhatsApp]." around its link. */
  copyBlockedBefore: 'Copying is blocked here. Select the text below, or ',
  copyBlockedLink: 'open WhatsApp',
  copyBlockedAfter: '.',
  whatsappText: 'Order text for WhatsApp',
  /** The supplier message, in the staff member's language. */
  waOrder: 'Workwear order',
  waOrderNumber: (recordNumber: string) => `Workwear order ${recordNumber}`,
  waEmployee: (employee: string) => `Employee: ${employee}`,
  waSize: (size: string) => `size ${size}`,
  waQty: (n: number) => `qty ${n}`,
  waPreparedBy: (name: string) => `Prepared by: ${name}`,
  waDate: (date: string) => `Date: ${date}`,
}

export type OrderText = typeof order
