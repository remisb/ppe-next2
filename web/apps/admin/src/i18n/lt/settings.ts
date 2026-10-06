import type { SettingsText } from '../en/settings'

export const settings: SettingsText = {
  title: 'Nustatymai',
  description: 'Visai organizacijai. Juos keičia tik administratoriai.',
  supplierChat: 'Tiekėjo WhatsApp grupė',
  supplierChatIntro:
    'Kopijuoti į WhatsApp nukopijuoja užsakymo žinutę ir pasiūlo atidaryti šią grupę, kur ją įklijuojate. WhatsApp negali atidaryti grupės su jau įrašyta žinute.',
  groupName: 'Grupės pavadinimas',
  groupNameHint: 'Kaip jį žino darbuotojai, pvz., Superman Rubai Group.',
  inviteLink: 'Pakvietimo nuoroda',
  inviteLinkHint: 'WhatsApp programėlėje: atidarykite grupę, palieskite jos pavadinimą, tada Pakviesti per nuorodą ir Kopijuoti nuorodą.',
  save: 'Išsaugoti',
  saving: 'Saugoma…',
  saved: 'Išsaugota.',
  clear: 'Pašalinti grupę',
  cleared: 'Pašalinta. Kopijuoti į WhatsApp atidaro WhatsApp nepasirinkus pokalbio.',
  notSet: 'Nenustatyta: Kopijuoti į WhatsApp atidaro WhatsApp nepasirinkus pokalbio.',
  current: (name: string) => `Kopijuoti į WhatsApp atidaro „${name}“.`,
  tryIt: 'Atidaryti grupę',
  nameRequired: 'Įrašykite grupės pavadinimą: darbuotojai jį mato prie Kopijuoti į WhatsApp.',
  invalidLink: 'Įklijuokite grupės pakvietimo nuorodą iš WhatsApp: ji prasideda https://chat.whatsapp.com/',
}
