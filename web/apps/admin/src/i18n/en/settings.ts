/** Settings: the organisation's settings an administrator changes (the supplier's WhatsApp group). */
export const settings = {
  title: 'Settings',
  description: 'For the whole organisation. Only administrators change them.',
  supplierChat: "Supplier's WhatsApp group",
  supplierChatIntro:
    'Copy for WhatsApp copies an order message and offers to open this group, where you paste it. WhatsApp cannot open a group with the message already typed in.',
  groupName: 'Group name',
  groupNameHint: 'As staff know it, e.g. Superman Rubai Group.',
  inviteLink: 'Invite link',
  inviteLinkHint: 'In WhatsApp: open the group, tap its name, then Invite via link (or Invite to group via link) and Copy link.',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved.',
  clear: 'Remove the group',
  cleared: 'Removed. Copy for WhatsApp opens WhatsApp without a chat chosen.',
  notSet: 'Not set: Copy for WhatsApp opens WhatsApp without a chat chosen.',
  current: (name: string) => `Copy for WhatsApp opens ${name}.`,
  tryIt: 'Open the group',
  nameRequired: 'Give the group a name: staff see it on Copy for WhatsApp.',
  invalidLink: 'Paste the group invite link from WhatsApp: it starts with https://chat.whatsapp.com/',
}

export type SettingsText = typeof settings
