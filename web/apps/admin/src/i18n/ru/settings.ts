import type { SettingsText } from '../en/settings'

export const settings: SettingsText = {
  title: 'Настройки',
  description: 'Для всей организации. Меняют их только администраторы.',
  supplierChat: 'Группа поставщика в WhatsApp',
  supplierChatIntro:
    'Копировать для WhatsApp копирует сообщение о заказе и предлагает открыть эту группу, где его нужно вставить. WhatsApp не умеет открывать группу с уже набранным сообщением.',
  groupName: 'Название группы',
  groupNameHint: 'Как её знают сотрудники, например Superman Rubai Group.',
  inviteLink: 'Ссылка-приглашение',
  inviteLinkHint: 'В WhatsApp: откройте группу, нажмите на её название, затем «Пригласить по ссылке» и «Копировать ссылку».',
  save: 'Сохранить',
  saving: 'Сохранение…',
  saved: 'Сохранено.',
  clear: 'Убрать группу',
  cleared: 'Убрано. Копировать для WhatsApp открывает WhatsApp без выбранного чата.',
  notSet: 'Не задано: Копировать для WhatsApp открывает WhatsApp без выбранного чата.',
  current: (name: string) => `Копировать для WhatsApp открывает «${name}».`,
  tryIt: 'Открыть группу',
  nameRequired: 'Укажите название группы: сотрудники видят его у кнопки «Копировать для WhatsApp».',
  invalidLink: 'Вставьте ссылку-приглашение в группу из WhatsApp: она начинается с https://chat.whatsapp.com/',
}
