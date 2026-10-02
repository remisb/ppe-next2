import type { Guide } from './guide'

const who = { admin: 'Administrators', manager: 'Managers', employee: 'The employee role' } as const

export const en: Guide = {
  title: 'User guide',
  lede: 'The app records workwear and safety equipment given to employees. You prepare an order and mark it as ordered. After the employee receives the items, they confirm receipt, and the app keeps a locked record in English and Russian.',
  language: 'Guide language',
  device: 'Device',
  devices: { phone: 'Phone', tablet: 'Tablet', desktop: 'Desktop' },
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
        { p: 'The bar at the bottom holds **Home**, **Orders**, **New order** and **Employees**. **More** holds the rest: the other sections, **Search**, **Help**, your account and **Sign out**.', devices: ['phone'] },
        { p: 'The rail on the left holds every section, with **Search** at the top. **Help**, your account and **Sign out** are at its foot.', devices: ['tablet'] },
        { p: 'The sidebar holds every section and **Search…** (`⌘K`). **Help**, **Keyboard shortcuts**, your account and **Sign out** are at its foot.', devices: ['desktop'] },
        { p: 'You stay signed in while the app is open, for up to 12 hours. After the tab has been closed, or the device asleep, for more than 15 minutes, sign in again.' },
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
            { text: 'Add the items:', items: ['**Item Set** adds a whole kit in one tap.', { text: '**Add Item** adds one item.', devices: ['phone', 'tablet'] }, { text: '**Add Item** adds one item. Press `/` to jump to it.', devices: ['desktop'] }] },
            {
              text: "Check each line's size and quantity:",
              items: ["Sizes come from the employee's saved sizes. Clothing is picked by letter, for example `S (44–46)`.", "You can't order until every missing size is chosen."],
            },
            { text: 'Tap **Review** in the bar at the bottom of the screen. It also shows the number of lines and the total.', devices: ['phone', 'tablet'] },
            { text: 'Choose **Review and mark as ordered** in the panel on the right, or press `⌘/Ctrl` `Enter`.', devices: ['desktop'] },
          ],
        },
        { p: 'This device keeps a draft of the order while you work. **Copy for WhatsApp**, for the supplier\'s message, is in the review.' },
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
            'Choose **Mark as Ordered**. The order is now **Ordered**, and you can no longer edit it. The app also creates the employee\'s confirmation link.',
            'Send the employee the link with **Share link via WhatsApp** or **Copy link**. The link is valid for 7 days, and the app shows it only once.',
          ],
        },
        { p: 'If the employee will sign on paper, choose **Print record** instead.' },
        { p: "**Copy for WhatsApp**, in the review, copies the message for the supplier. When an administrator has set the supplier's WhatsApp group in **Settings**, it then offers to open that group: paste the message there." },
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
            'They check the items, in English or Russian (**EN / RU**). The page opens in their preferred language when it is English or Russian.',
            'They tick the statement and tap **Confirm receipt**. The order becomes **Given**.',
          ],
        },
        { shots: [{ name: 'confirm-phone', alt: 'The confirmation page on a phone', phone: true }] },
      ],
    },
    {
      id: 'orders',
      title: 'Orders',
      blocks: [
        { p: '**Orders** lists every order placed. **Create Order**, at the top, starts a new one.' },
        {
          p: '**Awaiting**, **Given** and **All** filter the orders by status. You can also filter by employee and date. Click a record number to open the order beside the list. `J` and `K` move between orders, and `Esc` closes the order.',
          devices: ['desktop'],
        },
        { p: '**Awaiting**, **Given** and **All** filter the orders by status. You can also filter by employee and date. Tap an order to open it; **Orders** at its top takes you back to the list.', devices: ['tablet'] },
        { p: '**Awaiting**, **Given** and **All** filter the orders by status; **Filters** holds the employee and date filters. Tap an order to open it; **Orders** at its top takes you back to the list.', devices: ['phone'] },
        { p: 'An **Ordered** order has these actions:' },
        {
          ul: [
            '**Open Employee Confirmation** makes a new link. It also records a signed paper copy (**Record signed paper confirmation**).',
            '**Hand over now** turns this device to the employee, who confirms on it in person.',
            '**Print Record** prints the record for signing.',
          ],
        },
        { p: '**⋯ → Delete order…** removes an order, such as a test order, after asking.', roles: ['manager'] },
        { shots: [{ name: 'history', alt: 'Orders with an ordered order open' }] },
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
        { p: 'The list shows each employee\'s sizes and note, and marks anyone missing a size. A long note is cut to one line; open the employee to read it all.', devices: ['phone', 'tablet'] },
        { p: "The list shows each employee's sizes and note, and marks anyone missing a size. A long note is cut to one line; point at it to read it all, or open the employee.", devices: ['desktop'] },
        { p: "Each employee's page shows:" },
        { ul: ['their sizes and preferred language;', 'every item given, with its usage time and replacement date;', 'orders not yet given.'] },
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
      id: 'settings',
      title: 'Settings',
      roles: ['admin'],
      blocks: [
        {
          p: "**Supplier's WhatsApp group**: enter the group's name and its invite link. In WhatsApp, open the group, tap its name, then **Invite via link** and **Copy link**.",
        },
        {
          p: '**Copy for WhatsApp** then offers to open that group, where you paste the order message. WhatsApp cannot open a group with the message already typed in. **Remove the group** goes back to opening WhatsApp without a chat chosen.',
        },
        { shots: [{ name: 'settings', alt: 'Settings: the supplier\'s WhatsApp group' }] },
      ],
    },
    {
      id: 'account',
      title: 'Your account',
      blocks: [
        {
          ul: [
            "**Language**: English, Lietuvių or Русский. The choice is saved on your account, so every device you sign in on uses it. The employee's confirmation page and the record stay in English and Russian.",
            '**Theme**: **Light**, **Dark** or **System**, which follows the device. It is kept on this device, and the sign-in page uses it too.',
            '**Change password**.',
            { text: '**Table rows**: **Compact** fits more rows on the screen.', devices: ['desktop'] },
          ],
        },
        { shots: [{ name: 'account', alt: 'Account: language, password and table rows' }] },
      ],
    },
    {
      id: 'shortcuts',
      title: 'Search and shortcuts',
      titleOn: { phone: 'Search', tablet: 'Search' },
      blocks: [
        { p: 'Open **More**, then **Search**, to find record numbers, employees, items and screens. For example, type a name, then choose **New order for …**.', devices: ['phone'] },
        { p: '**Search**, at the top of the rail, finds record numbers, employees, items and screens. For example, type a name, then choose **New order for …**.', devices: ['tablet'] },
        {
          keys: [
            ['`⌘K` / `Ctrl K`', 'Search record numbers, employees, items and screens. For example, type a name, then choose **New order for …**.'],
            ['`/`', 'Go to the search or Add Item field.'],
            ['`G` then `D` `O` `H` `E` `C` `S` `U`', 'Go to Dashboard, Create Order, Orders, Employees, Catalogue, Item Sets or Users.'],
            ['`J` / `K`, `Esc`', 'Move through Orders, or close the open order.'],
            ['`⌘/Ctrl` `Enter`', 'On Create Order, review the order.'],
            ['`?`', 'Show all shortcuts.'],
          ],
          devices: ['desktop'],
        },
        { shots: [{ name: 'palette', alt: 'The ⌘K search finding an employee' }] },
      ],
    },
  ],
  footer: 'The screenshots show demo data. Item names are data, so they show as entered.',
}
