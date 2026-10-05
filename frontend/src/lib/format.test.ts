import dayjs from 'dayjs'
import { describe, expect, it } from 'vitest'

import { isDebt, money, period, periodParam, quantity } from './format'

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

describe('format', () => {
  it('formats money from API decimal strings', () => {
    expect(nbsp(money('1234.5'))).toBe('1 234,50 ₽')
    expect(money(null)).toBe('—')
  })

  it('formats quantities with units', () => {
    expect(nbsp(quantity('12.500', 'м³'))).toBe('12,5 м³')
    expect(quantity(undefined)).toBe('—')
  })

  it('formats billing periods', () => {
    expect(period('2026-09-01')).toBe('сентябрь 2026')
    expect(periodParam(dayjs('2026-09-15'))).toBe('2026-09')
  })

  it('detects debt', () => {
    expect(isDebt('10.00')).toBe(true)
    expect(isDebt('-5')).toBe(false)
    expect(isDebt(null)).toBe(false)
  })
})
