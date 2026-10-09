import type { Guide } from './guide'

const who = { admin: 'Administrators', manager: 'Managers', employee: 'The employee role' } as const

export const en: Guide = {
  title: 'User guide',
  lede: "The app records workwear and safety equipment given to employees. You prepare an order and mark it as ordered. After the employee receives the items, they confirm receipt, and the app keeps a locked record in English and Russian. It also keeps track of the company's SIM cards, equipment and furniture, and who holds each one.",
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
        {
          shots: [
            { name: 'sign-in', alt: 'The sign-in screen with email, password and Keep me signed in', phone: true },
            { name: 'sign-in-dark', alt: 'The same screen with the Dark theme', phone: true },
          ],
        },
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
        { p: "An order's **Changes** list what happened to it and who did it: ordered, a link made or opened, given." },
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
        { ul: ['their sizes and preferred language;', 'every item given, with its usage time and replacement date;', 'orders not yet given;', 'the company assets they hold, and held before: **Given SIM** and **Equipment**;', '**Changes**: who changed their details or sizes, and when.'] },
        { p: 'From that page, **New order** starts an order for them, and **Edit Sizes** changes their sizes.' },
        { p: 'An employee who still holds a company asset cannot be deleted: leaving never returns it. Register its return first.', roles: ['admin', 'manager'] },
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
        { p: "An item can also have a **Purchase price**: what we pay the supplier. It is optional, never needed to order, and orders don't show it. The item's page shows both prices and how they changed, and its **Changes** list who changed the item, and when." },
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
      id: 'assets',
      title: 'Company Assets',
      blocks: [
        {
          p: '**Company Assets** records the SIM cards, equipment and furniture the company gives employees: where each one is, who holds it, and the signed form for each giving. It has two tabs, **SIM Cards** and **Equipment & Furniture**. Each item is one record with its own inventory number, so three identical laptops are three assets.',
        },
        { p: 'Open it from **More**.', devices: ['phone'] },
        { p: 'Open it from the rail.', devices: ['tablet'] },
        { p: 'Open it from the sidebar, or press `G` then `A`.', devices: ['desktop'] },
        { p: 'The **Company Assets** card on the Dashboard shows the same figures. Choose one to open the list on it.', roles: ['admin', 'manager'] },
        {
          p: 'The tiles at the top count what is **In Office**, **With Employees** and **Not Returned**. Choose a tile to show only those; the figures overlap, since a card not returned is still with an employee. Search by number or employee, and filter by status, location and provider, or by category for equipment.',
          devices: ['tablet', 'desktop'],
        },
        {
          p: 'The tiles at the top count what is **In Office**, **With Employees** and **Not Returned**. Tap a tile to show only those; the figures overlap, since a card not returned is still with an employee. Search by number or employee; **Filters** holds status, location and provider, or category for equipment.',
          devices: ['phone'],
        },
        {
          p: "A SIM card's **Status** is what the provider confirms: **Not Activated**, **Active** or **Blocked**. It is separate from where the card is and who holds it: blocking a card does not return it, and returning it does not change its status.",
        },
        { shots: [{ name: 'assets', alt: 'The SIM cards: the tiles, the filters and each card with its holder' }] },
        {
          p: '**Add SIM Card** registers a card as it arrives from the provider. Its SIM No., provider and inventory number, the next one suggested, are needed now; the phone number, plan and non-return value can wait until it is given. On **Equipment & Furniture**, **Add Asset** registers one item: its name and category, which suggests its number, such as `PC-000003`.',
          roles: ['admin', 'manager'],
        },
        { p: "**Change Status** records the status the provider confirmed. It does not activate or block the card: email the provider for that.", roles: ['admin', 'manager'] },
        { p: 'To give a SIM card or an item:', roles: ['admin', 'manager'] },
        {
          ol: [
            "Open it and choose **Give SIM Card** or **Give Asset**. On an employee's page, the same button under **Given SIM** or **Equipment** starts from the employee and lists what is in the office.",
            'Choose the employee and the given date: today, or earlier.',
            '**Print Form** opens the assignment form in a new tab. Print it and have the employee sign it.',
            'Tick **Paper Form Signed**, then choose **Give SIM Card** or **Give Asset**.',
          ],
          roles: ['admin', 'manager'],
        },
        {
          p: "Only an **Active** card in the office, with a phone number, can be given; until then the button says what is missing. If the form changes after printing, **Paper Form Signed** is cleared: print it again. Furniture and other items are given without a form.",
          roles: ['admin', 'manager'],
        },
        {
          shots: [
            { name: 'asset', alt: "A SIM card's page: its status, holder and assignments" },
            { name: 'give-asset', alt: 'Give SIM Card with the employee chosen and the form printed' },
          ],
          roles: ['admin', 'manager'],
        },
        { shots: [{ name: 'asset', alt: "A SIM card's page: its status, holder and assignments" }], roles: ['employee'] },
        {
          p: 'When it is physically back in the office, **Register SIM Return** or **Register Asset Return** puts it there. Each giving and return stays on its page under **Assignments**, with **Print form again** for its form.',
          roles: ['admin', 'manager'],
        },
        {
          p: 'Leaving never returns anything. When an employee does not give a card back, **Mark as Not Returned** records where it is: still with them, or unknown. It stays theirs until it comes back. **Prepare Blocking Email** then gives the text to copy into your own email to the provider; once they confirm, choose **Blocked** in **Change Status**.',
          roles: ['admin', 'manager'],
        },
        { p: 'Search finds a SIM card by its SIM, phone or inventory number, and an item by its inventory number.' },
      ],
    },
    {
      id: 'administration',
      title: 'Administration',
      roles: ['admin'],
      blocks: [
        {
          p: "**Administration** is where you manage who may use the app and what they may do, watch over how it runs, and keep the organisation's settings. It opens on **Overview**. Its other screens are **Users**, **Roles & permissions**, **Audit log**, **Security**, **System**, **Usage** and **Settings**.",
        },
        {
          p: 'Open it from **More**. It has a bar of its own at the bottom, with **Overview**, **Users**, **Audit** and **Security**. Its **More** holds **Roles & permissions**, **System**, **Usage** and **Settings**, then **Workwear & Equipment**, which takes you back, your account and **Sign out**.',
          devices: ['phone'],
        },
        { p: 'Open it with **Admin** at the foot of the rail. It has a rail of its own; **Workwear**, at its foot, takes you back.', devices: ['tablet'] },
        { p: 'Open it with **Administration** at the foot of the sidebar. It has a sidebar of its own; **Workwear & Equipment**, at its foot, takes you back.', devices: ['desktop'] },
        {
          p: 'You are signed in to both at once, and **Sign out** in either signs you out of both. Anyone whose roles let them manage users, roles or settings, or read the Audit log, Security, System, Usage or the backups, sees **Administration**, with only the screens their roles open.',
        },
      ],
    },
    {
      id: 'overview',
      title: 'Overview',
      roles: ['admin'],
      blocks: [
        {
          p: "**Overview** answers the question: is anything wrong? **Needs attention** lists what to look at, the most urgent first, each with a link to where it is put right. When all is well, it says **Nothing needs your attention.**",
        },
        {
          ul: [
            'A backup failed, or backups have stopped.',
            'A copied sign-in was used, or many sign-ins failed.',
            'Requests are failing, or a new kind of error appeared.',
            'The access review is due. Review access every 90 days.',
            'The Audit log does not match its seals: someone changed it behind the app.',
            'Seals are not being timestamped: the timestamp service has not answered for a day.',
          ],
        },
        { p: '**Figures**, below, show active users, who is signed in now, sign-ins today, the last 24 hours of requests, the database and the last backup.' },
        { shots: [{ name: 'overview', alt: 'Overview: what needs attention, then the figures' }] },
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
            '**Administrator**, **Manager** and **Employee** are built in. **Administrator** can do everything and cannot be changed: **View** shows what it allows. You can change what **Manager** and **Employee** allow, but not their names or descriptions, and you cannot delete them.',
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
      id: 'audit',
      title: 'Audit log',
      roles: ['admin'],
      blocks: [
        {
          p: '**Audit log** lists every recorded change: what changed, who made it, when, and where. A change is made in **Workwear & Equipment**, in **Administration**, through an employee\'s **Confirmation link**, or by the **System** itself.',
        },
        {
          p: 'Filter by **Area**, **Change**, **Person** and dates. Click a change to open it beside the list. It shows each field before and after, and **Open in Workwear & Equipment** opens the record. **All changes to this record** narrows the list to it.',
          devices: ['desktop'],
        },
        {
          p: 'Filter by **Area**, **Change**, **Person** and dates. Tap a change to open it. It shows each field before and after, and **Open in Workwear & Equipment** opens the record. **All changes to this record** narrows the list to it.',
          devices: ['tablet'],
        },
        {
          p: '**Filters** holds the area, change, person and date filters. Tap a change to open it. It shows each field before and after, and **Open in Workwear & Equipment** opens the record. **All changes to this record** narrows the list to it.',
          devices: ['phone'],
        },
        {
          ul: [
            "**Seals**, at the top: each day's changes are sealed an hour after the day ends, with a hash that also covers the day before, so a change altered, added or removed afterwards shows. **Verify** checks every seal again; the app also checks them every hour.",
            'Each seal also gets a timestamp: a public timestamp service signs the seal with the time. A seal made again later cannot get the original time, so not even someone with access to the server can rewrite the log unnoticed. The panel says through which day the seals are timestamped.',
            'If a sealed day does not match, or its timestamp is wrong, late or missing, the Overview says so. Tell whoever runs the server, and keep the backups from before that day.',
            '**Export** downloads the changes the filters select, between two days at most a year apart, as **CSV, for a spreadsheet** or **JSON lines, for an archive**. The export is itself recorded on the Audit log.',
            'Changes are kept for years (10, unless the server is set otherwise), then deleted a day at a time.',
          ],
        },
        { shots: [{ name: 'audit-log', alt: 'Audit log: a price change open, with the fields before and after' }] },
      ],
    },
    {
      id: 'security',
      title: 'Security',
      roles: ['admin'],
      blocks: [
        { p: '**Security** has three tabs:' },
        {
          ul: [
            '**Sign-ins**: every sign-in, failed attempt, confirmed password and sign-out, with the account, the address it came from and the device. Filter by event, person and dates. A failed attempt says why, such as **Wrong password**. Sign-in records are kept 180 days.',
            "**Signed-in devices**: every browser someone is signed in on now. **Sign out** a device that is lost or not recognised: that person must sign in again there, with their password.",
            '**Access review**: every user with their roles, what those allow, and their last sign-in. Administrators, and accounts not used for 90 days, are marked. Check that each still needs their access, change it on **Users**, then choose **Mark as reviewed**. Do it every 90 days: the Overview reminds you.',
          ],
        },
        {
          p: '**Copied sign-in stopped** means someone used an old copy of a sign-in, so it was ended on every device that held it. Ask the user whether it was them. If not, have them change their password.',
        },
        {
          shots: [
            { name: 'security', alt: 'Security: sign-ins with their address and device' },
            { name: 'access-review', alt: 'The access review: users, their roles and last sign-in' },
          ],
        },
      ],
    },
    {
      id: 'system',
      title: 'System',
      roles: ['admin'],
      blocks: [
        { p: '**System** shows how the app is running. It has three tabs: **Status**, **Errors** and **Backups**.' },
        {
          ul: [
            "**Status**: whether the app is **Ready**, its version and when it started; the last 24 hours of requests, how many failed and how long they took; the database's size and latest migration; and how long sign-ins, errors and changes are kept.",
            "**Errors**: what went wrong, on the server or in someone's browser, with how many times and when last. Open one to see who met it, where and on what device. Errors are kept 30 days.",
            '**Backups**: below.',
          ],
        },
        {
          p: 'When something goes wrong, the app shows a **Reference**, such as `9f2c1a7e`. The error on **Errors** shows the same reference. Pass it on to whoever runs the server: it finds the error in the server\'s log.',
        },
        {
          shots: [
            { name: 'system', alt: 'System: the app, its requests and the database' },
            { name: 'errors', alt: 'Errors: an error open, with its reference' },
          ],
        },
      ],
    },
    {
      id: 'backups',
      title: 'Backups',
      roles: ['admin'],
      blocks: [
        {
          p: "**System → Backups** shows whether the database is backed up. The backup service on the server copies the whole database on a schedule, every night unless set otherwise, and deletes old copies after the retention period.",
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
      id: 'usage',
      title: 'Usage',
      roles: ['admin'],
      blocks: [
        { p: '**Usage** shows how the apps are used. No page is tracked: everything comes from what the app records anyway.' },
        {
          ul: [
            "At the top: the people active today, in the last 7 and in the last 30 days, out of the active accounts, and today's sign-ins.",
            '**Active people per day**, by app, with a line for each role. **Sign-ins per day**, with the failed ones.',
            '**Confirmation links, last 90 days**: how many links employees were sent, opened and confirmed, and how many are still waiting, expired or were replaced.',
            '**Changes per week**, by area, darker for more, and the people who made the most.',
            '**Devices, last 30 days** and **Languages**: phones, tablets and computers with their systems and browsers, and the languages of users and employees.',
            '**Data quality, last 90 days**: employees without sizes, and items without a price or service period. Fewer is better.',
          ],
        },
        { shots: [{ name: 'usage', alt: 'Usage: active people, sign-ins and more' }] },
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
        { p: 'Open **More**, then **Search**, to find record numbers, employees, items, company assets and screens. For example, type a name, then choose **New order for …**.', devices: ['phone'] },
        { p: '**Search**, at the top of the rail, finds record numbers, employees, items, company assets and screens. For example, type a name, then choose **New order for …**.', devices: ['tablet'] },
        {
          keys: [
            ['`⌘K` / `Ctrl K`', 'Search record numbers, employees, items, company assets and screens. For example, type a name, then choose **New order for …**.'],
            ['`/`', 'Go to the search or Add Item field.'],
            ['`G` then `D` `O` `H` `E` `A` `C` `S` `U`', 'Go to Dashboard, Create Order, Orders, Employees, Company Assets, Catalogue, Item Sets or Users (in Administration).'],
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
