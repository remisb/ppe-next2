import type { Guide } from './guide'

const who = { admin: 'Administrators', manager: 'Managers', employee: 'The employee role' } as const

export const en: Guide = {
  title: 'User guide',
  lede: 'The app records workwear and safety equipment given to employees. You prepare an order and mark it as ordered. After the employee receives the items, they confirm receipt, and the app keeps a locked record in English and Russian.',
  language: 'Guide language',
  contents: 'Contents',
  key: 'Key',
  does: 'Does',
  onlyFor: (roles) => `${roles.map((r, i) => (i === 0 ? who[r] : who[r].toLowerCase())).join(' and ')} only`,
  sections: [
    {
      id: 'sign-in',
      title: 'Sign in',
      blocks: [
        {
          ol: [
            'Open **workwear.gavort.nl** and sign in with your email and password.',
            {
              text: 'Your first screen depends on your role:',
              items: [
                { text: 'Administrators start on the **Dashboard**.', roles: ['admin'] },
                { text: 'Managers start on the **Manager Dashboard**.', roles: ['manager'] },
                { text: 'The employee role starts on the **Employee Dashboard**.', roles: ['employee'] },
              ],
            },
          ],
        },
        { shots: [{ name: 'sign-in', alt: 'The sign-in screen with email and password', phone: true }] },
      ],
    },
    {
      id: 'dashboard',
      title: 'Dashboard',
      blocks: [
        { p: "The figures at the top show the orders awaiting confirmation, this month's spending and the replacements due.", roles: ['admin'] },
        { p: '**Needs you** lists what to do next, most urgent first. Each line has a button for its task:', roles: ['admin'] },
        {
          ul: ['An overdue item: **Reorder**.', 'An unconfirmed order: **Send link**.', 'A missing size: **Add sizes**.', 'An item without a price: **Fix**.'],
          roles: ['admin'],
        },
        { shots: [{ name: 'dashboard', alt: 'The Dashboard: figures and the Needs you list' }], roles: ['admin'] },
        {
          p: 'The **Manager Dashboard** covers items, prices and purchasing: what is on order, spending by item, the replacements that will need buying, recent price changes, what holds up ordering in the catalogue and item sets, and the sizes to stock.',
          roles: ['manager'],
        },
        {
          p: "The **Employee Dashboard** starts with what needs doing: your orders still waiting for the employee's confirmation (**Send link**), items due for replacement and employees missing a size. Below are your orders by month and those given recently.",
          roles: ['employee'],
        },
      ],
    },
    {
      id: 'create',
      title: 'Create an order',
      blocks: [
        {
          ol: [
            'Open **Create Order**.',
            "In **Assigned to**, type part of the employee's name. For someone new, choose **+ Add New Employee**.",
            { text: 'Add the items:', items: ['**Item Set** adds a whole kit in one tap.', '**Add Item** adds one item. Press `/` to jump to it.'] },
            {
              text: "Check each line's size and quantity:",
              items: ["Sizes come from the employee's saved sizes. Clothing is picked by letter, for example `S (44–46)`.", "You can't order until every missing size is chosen."],
            },
            'Choose **Review and mark as ordered**, or press `⌘/Ctrl` `Enter`.',
          ],
        },
        { p: 'This device keeps a draft of the order while you work. **Copy for WhatsApp** copies the message for the supplier.' },
        { shots: [{ name: 'create-order', alt: 'Create Order with an employee, a kit applied and sizes chosen' }] },
      ],
    },
    {
      id: 'review',
      title: 'Review and Mark as Ordered',
      blocks: [
        {
          ol: [
            'Check the lines and the total.',
            'If the employee will confirm on their phone, leave **Create the confirmation link as well** ticked.',
            'Choose **Mark as Ordered**. The order is now **Ordered**, and you can no longer edit it.',
            'Send the employee the link with **Share link via WhatsApp** or **Copy link**. The link is valid for 7 days, and the app shows it only once.',
          ],
        },
        { p: 'If the employee will sign on paper, choose **Print record** instead.' },
        {
          shots: [
            { name: 'review', alt: 'The Review order dialog' },
            { name: 'ordered', alt: 'The ordered order with its confirmation link' },
          ],
        },
      ],
    },
    {
      id: 'confirm',
      title: 'The employee confirms',
      blocks: [
        {
          ol: [
            "The employee opens the link. They don't need an account.",
            'They check the items, in English or Russian (**EN / RU**).',
            'They tick the statement and tap **Confirm receipt**. The order becomes **Given**.',
          ],
        },
        { shots: [{ name: 'confirm-phone', alt: 'The confirmation page on a phone', phone: true }] },
      ],
    },
    {
      id: 'history',
      title: 'History',
      blocks: [
        {
          p: '**Awaiting**, **Given** and **All** filter the orders by status. You can also filter by employee and date. Click a record number to open the order beside the list. `J` and `K` move between orders, and `Esc` closes the order.',
        },
        { p: 'An **Ordered** order has these actions:' },
        {
          ul: [
            '**Open Employee Confirmation** makes a new link. It also records a signed paper copy (**Record signed paper confirmation**).',
            '**Hand over now** turns this device to the employee, who confirms on it in person.',
            '**Print Record** prints the record for signing.',
            '**Copy for WhatsApp** copies the supplier message.',
          ],
        },
        { p: '**⋯ → Delete order…** removes an order, such as a test order, after asking.', roles: ['manager'] },
        { shots: [{ name: 'history', alt: 'History with an ordered order open beside the list' }] },
      ],
    },
    {
      id: 'record',
      title: 'Items Given Record',
      blocks: [
        { p: 'A **Given** order has a locked record in English and Russian. Open it with **View Record**.' },
        { ul: ['**Print Record** prints it on one A4 page.', '**Share via WhatsApp** sends it.'] },
        { shots: [{ name: 'record', alt: 'The bilingual Items Given Record' }] },
      ],
    },
    {
      id: 'employees',
      title: 'Employees',
      blocks: [
        { p: "The list shows each employee's sizes and note, and marks anyone missing a size. A long note is cut to one line; point at it to read it all, or open the employee." },
        { p: "Each employee's page shows:" },
        { ul: ['their sizes;', 'every item given, with its usage time and replacement date;', 'orders not yet given.'] },
        { p: 'From that page, **New order** starts an order for them, and **Edit Sizes** changes their sizes.' },
        {
          shots: [
            { name: 'employees', alt: 'The Employees list' },
            { name: 'employee', alt: "An employee's page with the items given" },
          ],
        },
      ],
    },
    {
      id: 'catalogue',
      title: 'Item Catalogue and Item Sets',
      blocks: [
        {
          p: "Each catalogue item has a price, a service period and a size group. You can't order an item without a price or service period. Changing a price never alters existing orders.",
        },
        { p: 'An item set is a kit of items with default quantities. You apply it on Create Order in one tap.' },
        { p: 'You add and change items in **Item Catalogue**, and kits in **Item Sets**.', roles: ['admin', 'manager'] },
        {
          shots: [
            { name: 'catalogue', alt: 'The Item Catalogue' },
            { name: 'item-sets', alt: 'Item Sets' },
          ],
        },
      ],
    },
    {
      id: 'users',
      title: 'Users',
      roles: ['admin'],
      blocks: [
        {
          ul: ['Add, edit or deactivate accounts, and give each one roles: admin, manager or employee.', 'To reset a password, use **⋯ → Reset password…**.'],
        },
        { shots: [{ name: 'users', alt: 'The Users screen' }] },
      ],
    },
    {
      id: 'account',
      title: 'Your account',
      blocks: [
        {
          ul: [
            "**Language**: English, Lietuvių or Русский. The choice is saved on your account, so every device you sign in on uses it. The employee's confirmation page and the record stay in English and Russian.",
            '**Change password**.',
            '**Table rows**: **Compact** fits more rows on a desktop screen.',
          ],
        },
        { shots: [{ name: 'account', alt: 'Account: language, password and table rows' }] },
      ],
    },
    {
      id: 'shortcuts',
      title: 'Search and shortcuts',
      blocks: [
        {
          keys: [
            ['`⌘K` / `Ctrl K`', 'Search record numbers, employees, items and screens. For example, type a name, then choose **New order for …**.'],
            ['`/`', 'Go to the search or Add Item field.'],
            ['`G` then `D` `O` `H` `E` `C` `S` `U`', 'Go to Dashboard, Create Order, History, Employees, Catalogue, Item Sets or Users.'],
            ['`J` / `K`, `Esc`', 'Move through History, or close the open order.'],
            ['`⌘/Ctrl` `Enter`', 'On Create Order, review the order.'],
            ['`?`', 'Show all shortcuts.'],
          ],
        },
        { shots: [{ name: 'palette', alt: 'The ⌘K search finding an employee' }] },
      ],
    },
  ],
  footer: 'The screenshots show demo data. Item names are data, so they show as entered.',
}
