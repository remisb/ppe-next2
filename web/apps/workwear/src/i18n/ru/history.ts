import { plural } from '@ppe/i18n'

import type { HistoryText } from '../en/history'

export const history: HistoryText = {
  title: 'Заказы',
  filters: 'Фильтры',
  status: 'Статус',
  employee: 'Сотрудник',
  recordNumber: 'Номер записи',
  recordInvalid: 'Введите номер записи, например WE-000004 или 4.',
  from: 'С',
  to: 'По',
  period: 'Дата',
  apply: 'Применить',
  customRange: 'Свой период',
  rangeFrom: (date: string) => `С ${date}`,
  rangeTo: (date: string) => `По ${date}`,
  periods: { all: 'Все даты', last7: 'Последние 7 дней', thisMonth: 'Этот месяц', prevMonth: 'Прошлый месяц', custom: 'Свой период…' },
  tabHelp: {
    all: {
      body: 'Все оформленные заказы: ожидающие подтверждения и выданные. Удалённые заказы не учитываются.',
      note: 'Заказано и Выдано всегда составляют это число. Каждая вкладка считает с учётом фильтров по сотруднику и дате.',
    },
    ORDERED: {
      body: 'Заказы, отмеченные как заказанные, получение которых сотрудник ещё не подтвердил.',
      note: (days: number) => `Подтвердить можно по ссылке, лично или подписанной бумажной записью. Ожидание дольше ${days} дн. отмечено красным.`,
    },
    GIVEN: {
      body: 'Заказы, получение которых сотрудник подтвердил: по ссылке, лично или подписанной бумажной записью. У каждого есть неизменяемая запись.',
      note: 'Срок использования считается со дня выдачи.',
    },
  },
  clearFilters: 'Сбросить фильтры',
  fromAfterTo: 'Дата «С» не может быть позже даты «По».',
  noMatch: 'Нет заказов по этим фильтрам.',
  nothingWaiting: 'Ничего не ожидает: все заказы подтверждены.',
  noneGiven: 'Ещё ни один заказ не выдан.',
  noOrders: 'Заказов пока нет. Они появляются здесь после «Отметить как заказанный».',
  colRecord: 'Запись',
  colEmployee: 'Сотрудник',
  colDate: 'Дата',
  colStatus: 'Статус',
  colTotal: 'Общая сумма',
  pages: 'Страницы',
  pageOf: (page: number, pages: number) => `Страница ${page} из ${pages}`,
  previous: 'Предыдущая',
  next: 'Следующая',
  order: 'Заказ',
  nextOrPrevious: 'следующий или предыдущий заказ',
  closeHint: 'закрыть',

  orderLabel: (record: string) => `Заказ ${record}`,
  closeOrder: 'Закрыть заказ',
  notDeleted: 'Заказ не удалён',
  waitingToday: 'Ожидает с сегодняшнего дня',
  waitingFor: (n: number) =>
    plural(n, { one: 'Ожидает # день', few: 'Ожидает # дня', many: 'Ожидает # дней', other: 'Ожидает # дня' }),
  longWait: (days: number) => ({
    title: `Ожидает больше ${days} дн.`,
    detail: 'Напомните сотруднику подтвердить по ссылке, лично или подписав бумажную запись.',
  }),
  orderDetails: 'Данные заказа',
  preparedByLabel: 'Оформил(а)',
  confirmedLabel: 'Подтверждено',
  confirmedHow: { ELECTRONIC: 'Электронно', PAPER: 'На бумаге', IN_PERSON: 'Лично, на устройстве сотрудника склада' },
  openConfirmation: 'Открыть подтверждение сотрудника',
  handOverNow: 'Выдать сейчас',
  viewOrder: 'Открыть заказ',
  printRecord: 'Печать записи',
  printOrder: 'Печать заказа',
  shareWhatsApp: 'Отправить в WhatsApp',
  deleteOrder: 'Удалить заказ…',
  deleteOrdered: (record: string, name: string) =>
    `Удалить ${record} (${name})? Заказ исчезнет из Заказов и сводок, а его ссылка для подтверждения перестанет работать. Только для демонстрационных и тестовых заказов; в приложении это нельзя отменить.`,
  deleteGiven: (record: string, name: string) =>
    `Удалить ${record} (${name})? Заказ выдан и подтверждён: он исчезнет из Заказов, сводок и списка «Требуется замена», а его запись больше нельзя будет открыть. Только для демонстрационных и тестовых заказов; в приложении это нельзя отменить.`,

  confirmationDescription: (record: string, name: string) =>
    `${record} · ${name}. Сотрудник подтверждает получение на защищённой странице или подписывает распечатанную запись.`,
  electronicConfirmation: 'Электронное подтверждение',
  createLink: 'Создать ссылку для подтверждения',
  createLinkShort: 'Создать ссылку',
  viewOrderShort: 'Открыть',
  confirmationLinkShort: 'Ссылка',
  paperConfirmation: 'Подтверждение на бумаге',
  paperSteps: 'Распечатайте запись, дайте сотруднику подписать её, затем отметьте, что подписанный экземпляр получен.',
  recordPaper: 'Отметить подписанное подтверждение на бумаге',
  sign: 'Отметить как подписанный и выданный',
  recordPaperQuestion: (name: string, record: string) =>
    `Отметить, что ${name} подписал(а) бумажную запись ${record}? Заказ получит статус «Выдано».`,
  confirmationLink: 'Ссылка для подтверждения',
  copied: 'Скопировано',
  copyLink: 'Копировать ссылку',
  linkValidUntil: (date: string) => `Действует до ${date}. Ссылка показывается один раз; новая ссылка заменяет её.`,
  openOnThisDevice: 'Открыть на этом устройстве',
  shareLinkWhatsApp: 'Отправить ссылку в WhatsApp',
  linkMessage: (name: string, record: string, url: string) => `${name}, пожалуйста, подтвердите получение спецодежды (${record}):\n${url}`,

  previewFailed: 'Не удалось загрузить заказ.',
  previewOrdered: (date: string) => `заказано ${date}`,
  previewOrderedGiven: (ordered: string, given: string) => `заказано ${ordered}, выдано ${given}`,
  andMore: (n: number) => `и ещё ${n}`,

  // Always shown with one decimal, so always the fraction form: "2,1 месяца".
  usage: (months: string) => `${months} месяца`,
  today: 'сегодня',
}
