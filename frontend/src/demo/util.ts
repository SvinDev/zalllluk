import type { DB } from './store'

export function nextId(db: DB): number {
  db.seq += 1
  return db.seq
}

export const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

// Числа в API приходят строками с фиксированной точностью — как Decimal на бэкенде.
export const money = (value: number): string => round(value, 2).toFixed(2)
export const qty = (value: number): string => round(value, 3).toFixed(3)
export const rate = (value: number): string => round(value, 4).toFixed(4)

export const nowIso = (): string => new Date().toISOString()

const pad = (n: number) => String(n).padStart(2, '0')

export const isoDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Первое число месяца в формате YYYY-MM-01 (расчётный период). */
export function periodOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}

export function addMonths(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number)
  return periodOf(new Date(y, m - 1 + months, 1))
}

/** Границы месяца [начало, конец) в локальном времени браузера. */
export function periodBounds(period: string): [Date, Date] {
  const [y, m] = period.split('-').map(Number)
  return [new Date(y, m - 1, 1), new Date(y, m, 1)]
}

export function parsePeriod(value: string | null): string | null {
  if (!value) return null
  return value.length === 7 ? `${value}-01` : `${value.slice(0, 7)}-01`
}

/** Детерминированный ГПСЧ (mulberry32) — демо-данные одинаковы у всех посетителей. */
export function random(seed: number) {
  let t = seed
  const next = () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  }
}

const LATIN_TO_CYRILLIC: Record<string, string> = {
  A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
}

export function normalizePlate(raw: string): string {
  return raw
    .replace(/[\s\-_.]/g, '')
    .toUpperCase()
    .replace(/[ABEKMHOPCTYX]/g, (ch) => LATIN_TO_CYRILLIC[ch])
}
