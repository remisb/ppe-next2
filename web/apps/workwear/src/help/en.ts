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
        { p: 'With **Keep me signed in** ticked, you stay signed in on this device after closing the app or restarting the device, for up to 30 days, or until you have not used it for 14 days. On a shared computer, untick it: you are signed out when the browser closes, and after 12 hours at the latest.' },
        { p: '**Sign out** ends your sign-in on this device. When you change your password, your other devices are signed out. When an administrator resets your password or deactivates your account, you are signed out everywhere.' },
        { shots: [{ name: 'sign-in', alt: 'The sign-in screen with email, password and Keep me signed in', phone: true }] },
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
        { p: 'The **Backups** card says whether the database is backed up. Choose it to open **Backups** in **Administration**.', roles: ['admin'] },
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
            { text: 'Tap **New order** in the bar at the bottom, or **Create Order** at the top of **Orders**.', devices: ['phone'] },
            { text: 'On **Orders**, choose **Create Order** at the top.', devices: ['tablet', 'desktop'] },
            "In **Assigned to**, type part of the employee's name. For someone new, choose **+ Add New Employee**.",
            { text: 'Add the items:', items: ['**Item Set** adds a whole kit in one tap.', { text: '**Add Item** adds one item.', devices: ['phone', 'tablet'] }, { text: '**Add Item** adds one item. Press `/` to jump to it.', devices: ['desktop'] }] },
            {
              text: "Check each line's size and quantity:",
              items: ["Sizes come from the employee's saved sizes. Clothing is picked by letter, for example `S (44–46)`.", "You can't order until every missing size is chosen.", "If you choose a size other than the employee's saved one, you're asked **Different size selected. Save it to employee profile?** **Save** keeps it for their future orders; **Skip size update** uses it on this order only."],
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
        { p: "**Copy for WhatsApp**, in the review, copies the message for the supplier. When an administrator has set the supplier's WhatsApp group in **Administration**, on **Settings**, it then offers to open that group: paste the message there." },
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
            'They check the items, their prices and the total, in English or Russian (**EN / RU**). The page opens in their preferred language when it is English or Russian.',
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
          p: "Each catalogue item has a price, a service period and a size group. Orders show and total the price. You can't order an item without a price or service period. Changing a price never alters existing orders.",
        },
        { p: "An item can also have a **Purchase price**: what we pay the supplier. It is optional, never needed to order, and orders don't show it. The item's page shows both prices and how they changed." },
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
      id: 'administration',
      title: 'Administration',
      roles: ['admin'],
      blocks: [
        { p: '**Administration** is where you manage who may use the app and what they may do, and the organisation\'s settings. It has four screens: **Users**, **Roles & permissions**, **Settings** and **Backups**.' },
        { p: 'Open it from **More**. It has a bar of its own at the bottom; its **More** holds **Workwear & Equipment**, which takes you back, your account and **Sign out**.', devices: ['phone'] },
        { p: 'Open it with **Admin** at the foot of the rail. It has a rail of its own; **Workwear**, at its foot, takes you back.', devices: ['tablet'] },
        { p: 'Open it with **Administration** at the foot of the sidebar. It has a sidebar of its own; **Workwear & Equipment**, at its foot, takes you back.', devices: ['desktop'] },
        { p: 'You are signed in to both at once, and **Sign out** in either signs you out of both. Anyone whose roles let them manage users, roles, settings or backups sees **Administration**, with only the screens their roles open.' },
      ],
    },
    {
      id: 'users',
      title: 'Users',
      roles: ['admin'],
      blocks: [
        {
          ul: [
            'Add, edit or deactivate accounts. Give each account one or more roles: a user may do what any of their roles allows. **Roles & permissions** says what each role allows.',
            'A role change reaches the user within minutes, without signing in again. A deactivated user is signed out on every device.',
            'To reset a password, use **⋯ → Reset password…**.',
            "You can't deactivate your own account, or take from yourself the role that lets you manage users or roles. Someone active always holds **Administrator**.",
            'If you signed in more than 12 hours ago, the app asks you to **Confirm your password** before saving the change.',
          ],
        },
        { shots: [{ name: 'users', alt: 'The Users screen' }] },
      ],
    },
    {
      id: 'roles',
      title: 'Roles & permissions',
      roles: ['admin'],
      blocks: [
        {
          p: '**Roles & permissions** lists each role, what it allows and how many users hold it. A role is a set of permissions, such as **Manage Item Catalogue** or **Delete employees**. You give roles to users on **Users**.',
        },
        {
          ul: [
            '**Administrator**, **Manager** and **Employee** are built in. **Administrator** can do everything and cannot be changed: **View** shows what it allows. You can change what **Manager** and **Employee** allow, but not their names, and you cannot delete them.',
            '**Add Role** makes a new one: a name, what it is for, and its permissions. Some permissions need another, which is ticked with them: **Manage users** needs **See users**.',
            'A change reaches the users who hold the role within minutes.',
            '**⋯ → Delete role…** deletes a role that no user holds. Take it from its users on **Users** first.',
            'If you signed in more than 12 hours ago, the app asks you to **Confirm your password** before saving the change.',
          ],
        },
        {
          shots: [
            { name: 'roles', alt: 'Roles & permissions: the built-in roles and the users holding them' },
            { name: 'role', alt: "A role's permissions, grouped, each with what it allows" },
          ],
        },
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
      id: 'backups',
      title: 'Backups',
      roles: ['admin'],
      blocks: [
        {
          p: '**Backups** shows whether the database is backed up. The backup service on the server copies the whole database on a schedule, every night unless set otherwise, and deletes old copies after the retention period.',
        },
        {
          p: 'The line at the top says whether all is well. It turns red when the last backup failed, when a scheduled one is overdue, or when the service has stopped reporting. Tell whoever runs the server.',
        },
        { p: 'A second warning shows while the backups are kept only on the server itself, because they would be lost with it.' },
        {
          ul: [
            '**Last backup** and **Next backup**: when, with the last one\'s size and how long it took.',
            '**Stored** and **Total size**: the backups kept now.',
            '**Recent backups**: every attempt, newest first, with the error of a failed one.',
            '**Settings**: the schedule, where backups are saved, how long they are kept and whether they are encrypted.',
          ],
        },
        { p: 'The settings are made on the server, and a backup is restored there too: the app only shows them.' },
        { shots: [{ name: 'backups', alt: 'Backups: the last backup, the recent ones and the settings' }] },
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
            '**Change password**: your other devices are signed out, and this one stays signed in.',
            '**Signed-in devices**: every browser you are signed in on, with when it was last used. **This device** comes first. Sign out a device you no longer use or do not recognise, or choose **Sign out all other devices**.',
            { text: '**Table rows**: **Compact** fits more rows on the screen.', devices: ['desktop'] },
          ],
        },
        { shots: [{ name: 'account', alt: 'Account: language, theme and password' }, { name: 'devices', alt: 'Signed-in devices: this device and a phone' }] },
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
            ['`G` then `D` `O` `H` `E` `C` `S` `U`', 'Go to Dashboard, Create Order, Orders, Employees, Catalogue, Item Sets or Users (in Administration).'],
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
