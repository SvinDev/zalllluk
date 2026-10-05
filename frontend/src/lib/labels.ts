import type {
  CalculationBasis,
  InvoiceStatus,
  MeterKind,
  PassKind,
  PassRead,
  PaymentMethod,
  ReadingSource,
  TariffMethod,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@/api/types'

type Tagged = { label: string; color: string }

export const roleLabels: Record<UserRole, string> = {
  admin: 'Администратор',
  manager: 'Управляющий',
  accountant: 'Бухгалтер',
  security: 'Охрана',
  resident: 'Житель',
}

export const meterKindLabels: Record<MeterKind, string> = {
  cold_water: 'Холодная вода',
  hot_water: 'Горячая вода',
  electricity: 'Электроэнергия',
  heating: 'Отопление',
  gas: 'Газ',
}

export const readingSourceLabels: Record<ReadingSource, string> = {
  resident: 'Житель',
  staff: 'Сотрудник',
  api: 'API',
  provider: 'Опрос системы',
}

export const tariffMethodLabels: Record<TariffMethod, string> = {
  per_area: 'По площади',
  per_resident: 'По числу жильцов',
  metered: 'По счётчику',
  fixed: 'Фиксированная',
}

export const invoiceStatuses: Record<InvoiceStatus, Tagged> = {
  draft: { label: 'Черновик', color: 'default' },
  issued: { label: 'Выставлена', color: 'blue' },
  partially_paid: { label: 'Частично оплачена', color: 'orange' },
  paid: { label: 'Оплачена', color: 'green' },
  cancelled: { label: 'Аннулирована', color: 'red' },
}

export const basisLabels: Record<CalculationBasis, string> = {
  tariff: '',
  meter: 'по показаниям',
  average: 'по среднему',
  normative: 'по нормативу',
  recalculation: 'перерасчёт',
}

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  bank: 'Банк',
  card: 'Карта / СБП',
  cash: 'Касса',
  other: 'Другое',
}

export const ticketStatuses: Record<TicketStatus, Tagged> = {
  new: { label: 'Новая', color: 'blue' },
  in_progress: { label: 'В работе', color: 'processing' },
  waiting: { label: 'Ожидает', color: 'gold' },
  resolved: { label: 'Выполнена', color: 'green' },
  closed: { label: 'Закрыта', color: 'default' },
  rejected: { label: 'Отклонена', color: 'red' },
}

export const ticketCategoryLabels: Record<TicketCategory, string> = {
  plumbing: 'Сантехника',
  electricity: 'Электрика',
  heating: 'Отопление',
  elevator: 'Лифт',
  cleaning: 'Уборка',
  territory: 'Двор и территория',
  intercom: 'Домофон',
  complaint: 'Жалоба',
  other: 'Другое',
}

export const ticketPriorities: Record<TicketPriority, Tagged> = {
  low: { label: 'Низкий', color: 'default' },
  normal: { label: 'Обычный', color: 'blue' },
  high: { label: 'Высокий', color: 'orange' },
  emergency: { label: 'Аварийный', color: 'red' },
}

export const passKindLabels: Record<PassKind, string> = {
  guest: 'Гость',
  vehicle: 'Автомобиль',
  delivery: 'Доставка',
}

export const passStatuses: Record<PassRead['status'], Tagged> = {
  pending: { label: 'На согласовании', color: 'gold' },
  active: { label: 'Действует', color: 'green' },
  rejected: { label: 'Отклонён', color: 'red' },
  used: { label: 'Использован', color: 'default' },
  cancelled: { label: 'Отменён', color: 'default' },
  expired: { label: 'Истёк', color: 'default' },
}

/** Опции для <Select> из словаря подписей. */
export function options<K extends string>(labels: Record<K, string | Tagged>) {
  return (Object.entries(labels) as [K, string | Tagged][]).map(([value, label]) => ({
    value,
    label: typeof label === 'string' ? label : label.label,
  }))
}
