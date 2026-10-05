/**
 * Упрощённый порт расчёта начислений бэкенда (app/billing): факт по показаниям,
 * норматив при их отсутствии и перерасчёт начисленного по нормативу.
 */
import type { CalculationBasis, MeterKind } from '@/api/types'

import type { ApartmentRec, DB, InvoiceLineRec, InvoiceRec, MeterRec, TariffRec } from './store'
import { addMonths, nextId, nowIso, periodBounds, round } from './util'

export const METER_UNITS: Record<MeterKind, string> = {
  cold_water: 'м³',
  hot_water: 'м³',
  electricity: 'кВт·ч',
  heating: 'Гкал',
  gas: 'м³',
}

export function tariffUnit(t: TariffRec): string {
  if (t.method === 'metered' && t.meter_kind) return METER_UNITS[t.meter_kind]
  return { per_area: 'м²', per_resident: 'чел.', fixed: 'мес.', metered: '' }[t.method]
}

const POSTED = new Set(['issued', 'partially_paid', 'paid'])

type Draft = Omit<InvoiceLineRec, 'id'>

function line(t: TariffRec, quantity: number, basis: CalculationBasis, extra: Partial<Draft> = {}): Draft {
  const q = round(quantity, 3)
  return {
    tariff_id: t.id,
    meter_id: null,
    service_name: t.name,
    unit: tariffUnit(t),
    quantity: q,
    rate: t.rate,
    amount: round(q * t.rate, 2),
    basis,
    reading_from: null,
    reading_to: null,
    details: null,
    ...extra,
  }
}

function meterLines(db: DB, apartment: ApartmentRec, t: TariffRec, meter: MeterRec, period: string): Draft[] {
  const name = `${t.name} (сч. № ${meter.serial_number})`
  // История начислений по счётчику: от новых к старым до последнего «фактического».
  const history = db.invoices
    .filter((i) => i.status !== 'cancelled' && i.period < period)
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .flatMap((i) => i.lines.filter((l) => l.meter_id === meter.id).reverse())
  let billedUpTo: number | null = null
  let estimatedQty = 0
  let estimatedAmount = 0
  let estimatedPeriods = 0
  for (const l of history) {
    if (l.basis === 'meter') {
      billedUpTo = l.reading_to
      break
    }
    if (l.basis === 'average' || l.basis === 'normative') {
      estimatedQty += l.quantity
      estimatedAmount += l.amount
      estimatedPeriods += 1
    }
  }

  const [start, end] = periodBounds(period)
  const current = db.readings
    .filter((r) => r.meter_id === meter.id && new Date(r.taken_at) >= start && new Date(r.taken_at) < end)
    .sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0]

  if (current) {
    const from = billedUpTo ?? meter.initial_value
    const lines = [
      line(t, current.value - from, 'meter', {
        service_name: name,
        meter_id: meter.id,
        reading_from: from,
        reading_to: current.value,
      }),
    ]
    if (estimatedQty) {
      const q = -round(estimatedQty, 3)
      const amount = -round(estimatedAmount, 2)
      lines.push({
        ...line(t, q, 'recalculation', { service_name: `Перерасчёт: ${name}`, meter_id: meter.id }),
        amount,
        rate: round(amount / q, 4),
        details: `снято начисленное без показаний за ${estimatedPeriods} мес.`,
      })
    }
    return lines
  }
  if (t.normative && apartment.residents_count > 0) {
    return [
      line(t, t.normative * apartment.residents_count, 'normative', {
        service_name: name,
        meter_id: meter.id,
        details: `показания не переданы: норматив × ${apartment.residents_count} чел.`,
      }),
    ]
  }
  return []
}

export function calculate(db: DB, apartment: ApartmentRec, period: string): Draft[] {
  const tariffs = db.tariffs
    .filter(
      (t) =>
        t.valid_from <= period &&
        (!t.valid_to || t.valid_to >= period) &&
        (t.building_id === null || t.building_id === apartment.building_id),
    )
    .sort((a, b) => a.id - b.id)
  const meters = db.meters.filter((m) => m.apartment_id === apartment.id && m.is_active)
  const lines: Draft[] = []
  for (const t of tariffs) {
    if (t.method === 'per_area') lines.push(line(t, apartment.area, 'tariff'))
    else if (t.method === 'per_resident') {
      if (apartment.residents_count > 0) lines.push(line(t, apartment.residents_count, 'tariff'))
    } else if (t.method === 'fixed') lines.push(line(t, 1, 'tariff'))
    else {
      const own = meters.filter((m) => m.kind === t.meter_kind)
      if (own.length === 0) {
        if (t.normative && apartment.residents_count > 0) {
          lines.push(
            line(t, t.normative * apartment.residents_count, 'normative', {
              details: `нет прибора учёта: норматив × ${apartment.residents_count} чел.`,
            }),
          )
        }
      } else {
        for (const meter of own) lines.push(...meterLines(db, apartment, t, meter, period))
      }
    }
  }
  return lines
}

export function balance(db: DB, apartmentId: number) {
  const charged = db.invoices
    .filter((i) => i.apartment_id === apartmentId && POSTED.has(i.status))
    .reduce((sum, i) => sum + i.amount, 0)
  const payments = db.payments.filter((p) => p.apartment_id === apartmentId)
  const paid = payments.reduce((sum, p) => sum + p.amount, 0)
  const last = payments.map((p) => p.paid_at).sort().at(-1) ?? null
  return { charged: round(charged), paid: round(paid), balance: round(charged - paid), last_payment_at: last }
}

/** Разносит все оплаты лицевого счёта по выставленным квитанциям от старых к новым. */
export function reallocate(db: DB, apartmentId: number): void {
  let pool = db.payments.filter((p) => p.apartment_id === apartmentId).reduce((s, p) => s + p.amount, 0)
  const invoices = db.invoices
    .filter((i) => i.apartment_id === apartmentId && POSTED.has(i.status))
    .sort((a, b) => (a.period === b.period ? a.id - b.id : a.period < b.period ? -1 : 1))
  for (const inv of invoices) {
    const allocated = round(Math.min(pool, inv.amount))
    pool = round(pool - allocated)
    inv.paid_amount = allocated
    inv.status = allocated >= inv.amount ? 'paid' : allocated > 0 ? 'partially_paid' : 'issued'
  }
}

export function runBilling(db: DB, period: string, buildingId: number | null) {
  const report = { created: 0, regenerated: 0, skipped_posted: 0, without_charges: 0, total: 0 }
  const apartments = db.apartments.filter((a) => buildingId === null || a.building_id === buildingId)
  for (const apartment of apartments) {
    const existing = db.invoices.find(
      (i) => i.apartment_id === apartment.id && i.period === period && i.status !== 'cancelled',
    )
    if (existing && existing.status !== 'draft') {
      report.skipped_posted += 1
      continue
    }
    const drafts = calculate(db, apartment, period)
    if (existing) db.invoices = db.invoices.filter((i) => i.id !== existing.id)
    if (drafts.length === 0) {
      report.without_charges += 1
      continue
    }
    const taken = db.invoices.filter((i) => i.apartment_id === apartment.id && i.period === period).length
    const base = `${apartment.account_number}-${period.slice(0, 4)}${period.slice(5, 7)}`
    const invoice: InvoiceRec = {
      id: nextId(db),
      number: taken ? `${base}-${taken + 1}` : base,
      apartment_id: apartment.id,
      period,
      status: 'draft',
      amount: round(drafts.reduce((s, l) => s + l.amount, 0)),
      opening_balance: 0,
      paid_amount: 0,
      due_date: null,
      issued_at: null,
      created_at: nowIso(),
      lines: drafts.map((l) => ({ ...l, id: nextId(db) })),
    }
    db.invoices.push(invoice)
    report.total = round(report.total + invoice.amount)
    if (existing) report.regenerated += 1
    else report.created += 1
  }
  return report
}

export function issueInvoice(db: DB, invoice: InvoiceRec, issuedAt = nowIso()): void {
  invoice.opening_balance = balance(db, invoice.apartment_id).balance
  invoice.status = 'issued'
  invoice.issued_at = issuedAt
  invoice.due_date = addMonths(invoice.period, 1).replace(/-01$/, '-10')
  reallocate(db, invoice.apartment_id)
}

export const totalDue = (i: InvoiceRec): number => Math.max(round(i.amount + i.opening_balance), 0)
