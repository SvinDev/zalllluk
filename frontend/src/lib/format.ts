import dayjs from 'dayjs'
import 'dayjs/locale/ru'

const rub = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' })
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 })

type Numeric = string | number | null | undefined

/** Деньги приходят из API строкой (Decimal) — без потери копеек. */
export function money(value: Numeric): string {
  if (value === null || value === undefined || value === '') return '—'
  return rub.format(Number(value))
}

export function quantity(value: Numeric, unit?: string): string {
  if (value === null || value === undefined || value === '') return '—'
  const formatted = number.format(Number(value))
  return unit ? `${formatted} ${unit}` : formatted
}

export function date(value: string | null | undefined): string {
  return value ? dayjs(value).format('DD.MM.YYYY') : '—'
}

export function dateTime(value: string | null | undefined): string {
  return value ? dayjs(value).format('DD.MM.YYYY HH:mm') : '—'
}

/** «2026-09-01» → «сентябрь 2026». */
export function period(value: string | null | undefined): string {
  return value ? dayjs(value).locale('ru').format('MMMM YYYY') : '—'
}

/** Значение для API-параметра периода: «2026-09». */
export function periodParam(value: dayjs.Dayjs): string {
  return value.format('YYYY-MM')
}

export function isDebt(balance: Numeric): boolean {
  return Number(balance ?? 0) > 0
}
