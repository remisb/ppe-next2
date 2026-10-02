/**
 * The Settings form's check of the supplier's WhatsApp group, the same rules
 * the server applies (internal/domain/settings): a name and a group invite link
 * together, or both empty to remove the group. The server has the last word
 * and tidies the link (it drops WhatsApp's ?mode=… suffix).
 */
export interface SupplierChatErrors {
  name?: 'required'
  link?: 'invalid' | 'required'
}

const inviteLink = /^https?:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}\/?(\?[^#\s]*)?$/i

export function checkSupplierChat(name: string, link: string): SupplierChatErrors {
  const n = name.trim()
  const l = link.trim()
  if (!n && !l) return {}
  const errors: SupplierChatErrors = {}
  if (!n) errors.name = 'required'
  if (!l) errors.link = 'required'
  else if (!inviteLink.test(l)) errors.link = 'invalid'
  return errors
}
