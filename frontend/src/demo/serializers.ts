/** Преобразование «строк таблиц» демо-хранилища в ответы API (типы — из OpenAPI). */
import type { components } from '@/api/schema'

import { METER_UNITS, tariffUnit, totalDue } from './billing'
import type {
  AnnouncementRec,
  ApartmentRec,
  DB,
  InvoiceRec,
  MeterRec,
  PassRec,
  PaymentRec,
  ReadingRec,
  TariffRec,
  TicketRec,
  UserRec,
} from './store'
import { money, qty, rate } from './util'

type S = components['schemas']

export const COMPANY: S['Payee'] = {
  name: 'ООО «УК Пример» (демо)',
  inn: '7700000000',
  kpp: '770001001',
  bank_name: 'ПАО «Банк»',
  bik: '044525000',
  bank_account: '40702810000000000000',
  corr_account: '30101810400000000000',
  address: 'г. Москва, ул. Примерная, д. 1',
  phone: '+7 (495) 000-00-00',
}

const find = <T extends { id: number }>(items: T[], id: number | null): T | undefined =>
  id === null ? undefined : items.find((item) => item.id === id)

export const userBrief = (u: UserRec | undefined): S['UserBrief'] | null =>
  u ? { id: u.id, full_name: u.full_name, email: u.email, phone: u.phone } : null

export const userRead = (u: UserRec): S['UserRead'] => ({
  ...userBrief(u)!,
  role: u.role,
  is_active: u.is_active,
  created_at: u.created_at,
})

export function buildingBrief(db: DB, id: number): S['BuildingBrief'] {
  const b = find(db.buildings, id)!
  return { id: b.id, address: b.address }
}

export function buildingRead(db: DB, id: number): S['BuildingRead'] {
  const b = find(db.buildings, id)!
  return {
    ...b,
    apartments_count: db.apartments.filter((a) => a.building_id === b.id).length,
  }
}

export const apartmentBrief = (db: DB, a: ApartmentRec): S['ApartmentBrief'] => ({
  id: a.id,
  number: a.number,
  account_number: a.account_number,
  building: buildingBrief(db, a.building_id),
})

export const apartmentRead = (db: DB, a: ApartmentRec): S['ApartmentRead'] => ({
  ...apartmentBrief(db, a),
  building_id: a.building_id,
  area: money(a.area),
  residents_count: a.residents_count,
  owner_name: a.owner_name,
})

export const apartmentDetail = (db: DB, a: ApartmentRec): S['ApartmentDetail'] => ({
  ...apartmentRead(db, a),
  residents: a.resident_ids.map((id) => userBrief(find(db.users, id))!).filter(Boolean),
})

export function meterRead(db: DB, m: MeterRec): S['MeterRead'] {
  const last = db.readings
    .filter((r) => r.meter_id === m.id)
    .sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0]
  return {
    id: m.id,
    apartment_id: m.apartment_id,
    apartment: apartmentBrief(db, find(db.apartments, m.apartment_id)!),
    kind: m.kind,
    unit: METER_UNITS[m.kind],
    serial_number: m.serial_number,
    external_id: m.external_id,
    installed_at: m.installed_at,
    verification_due: m.verification_due,
    initial_value: qty(m.initial_value),
    is_active: m.is_active,
    last_reading: last ? { value: qty(last.value), taken_at: last.taken_at, source: last.source } : null,
  }
}

/** Расход каждого показания относительно предыдущего (или начального значения счётчика). */
export function consumptionMap(db: DB): Map<number, number> {
  const result = new Map<number, number>()
  const byMeter = new Map<number, ReadingRec[]>()
  for (const r of db.readings) byMeter.set(r.meter_id, [...(byMeter.get(r.meter_id) ?? []), r])
  for (const [meterId, readings] of byMeter) {
    let previous = find(db.meters, meterId)?.initial_value ?? 0
    for (const r of readings.sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1))) {
      result.set(r.id, r.value - previous)
      previous = r.value
    }
  }
  return result
}

export const readingRead = (r: ReadingRec, consumption: number | undefined): S['ReadingRead'] => ({
  id: r.id,
  meter_id: r.meter_id,
  value: qty(r.value),
  taken_at: r.taken_at,
  source: r.source,
  submitted_by_id: r.submitted_by_id,
  created_at: r.created_at,
  consumption: consumption === undefined ? null : qty(consumption),
})

export function journalItem(db: DB, r: ReadingRec, consumption: number | undefined): S['ReadingJournalItem'] {
  const m = find(db.meters, r.meter_id)!
  return {
    ...readingRead(r, consumption),
    meter: {
      id: m.id,
      kind: m.kind,
      unit: METER_UNITS[m.kind],
      serial_number: m.serial_number,
      apartment: apartmentBrief(db, find(db.apartments, m.apartment_id)!),
    },
  }
}

export const tariffRead = (t: TariffRec): S['TariffRead'] => ({
  ...t,
  unit: tariffUnit(t),
  rate: rate(t.rate),
  normative: t.normative === null ? null : rate(t.normative),
})

export const invoiceRead = (db: DB, i: InvoiceRec): S['InvoiceRead'] => ({
  id: i.id,
  number: i.number,
  apartment: apartmentBrief(db, find(db.apartments, i.apartment_id)!),
  period: i.period,
  status: i.status,
  amount: money(i.amount),
  opening_balance: money(i.opening_balance),
  total_due: money(totalDue(i)),
  paid_amount: money(i.paid_amount),
  due_date: i.due_date,
  issued_at: i.issued_at,
  created_at: i.created_at,
})

function paymentQr(db: DB, i: InvoiceRec): string {
  const a = find(db.apartments, i.apartment_id)!
  const [y, m] = i.period.split('-')
  const fields: [string, string][] = [
    ['Name', COMPANY.name],
    ['PersonalAcc', COMPANY.bank_account],
    ['BankName', COMPANY.bank_name],
    ['BIC', COMPANY.bik],
    ['CorrespAcc', COMPANY.corr_account],
    ['PayeeINN', COMPANY.inn],
    ['KPP', COMPANY.kpp],
    ['Sum', String(Math.round(totalDue(i) * 100))],
    ['Purpose', `Оплата ЖКУ за ${m}.${y}, л/с ${a.account_number}`],
    ['PersAcc', a.account_number],
    ['PaymPeriod', `${m}${y}`],
    ['PayerAddress', `${buildingBrief(db, a.building_id).address}, кв. ${a.number}`],
  ]
  return ['ST00012', ...fields.map(([k, v]) => `${k}=${v.replaceAll('|', ' ')}`)].join('|')
}

export const invoiceDetail = (db: DB, i: InvoiceRec): S['InvoiceDetail'] => ({
  ...invoiceRead(db, i),
  apartment: apartmentRead(db, find(db.apartments, i.apartment_id)!),
  lines: i.lines.map((l) => ({
    id: l.id,
    service_name: l.service_name,
    unit: l.unit,
    quantity: qty(l.quantity),
    rate: rate(l.rate),
    amount: money(l.amount),
    basis: l.basis,
    meter_id: l.meter_id,
    reading_from: l.reading_from === null ? null : qty(l.reading_from),
    reading_to: l.reading_to === null ? null : qty(l.reading_to),
    details: l.details,
  })),
  payee: COMPANY,
  payment_qr:
    (i.status === 'issued' || i.status === 'partially_paid') && totalDue(i) > 0 ? paymentQr(db, i) : null,
})

export const paymentRead = (db: DB, p: PaymentRec): S['PaymentRead'] => ({
  id: p.id,
  apartment: apartmentBrief(db, find(db.apartments, p.apartment_id)!),
  amount: money(p.amount),
  paid_at: p.paid_at,
  method: p.method,
  reference: p.reference,
  comment: p.comment,
  created_at: p.created_at,
})

const OPEN = new Set(['new', 'in_progress', 'waiting'])
export const isOverdue = (t: TicketRec) => OPEN.has(t.status) && new Date(t.due_at) < new Date()

export function ticketRead(db: DB, t: TicketRec): S['TicketRead'] {
  const apartment = find(db.apartments, t.apartment_id)
  return {
    id: t.id,
    building: buildingBrief(db, t.building_id),
    apartment: apartment ? { id: apartment.id, number: apartment.number } : null,
    author: userBrief(find(db.users, t.author_id)),
    assignee: userBrief(find(db.users, t.assignee_id)),
    category: t.category,
    priority: t.priority,
    status: t.status,
    subject: t.subject,
    due_at: t.due_at,
    is_overdue: isOverdue(t),
    resolved_at: t.resolved_at,
    closed_at: t.closed_at,
    rating: t.rating,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }
}

export const ticketDetail = (db: DB, t: TicketRec, staff: boolean): S['TicketDetail'] => ({
  ...ticketRead(db, t),
  description: t.description,
  rating_comment: t.rating_comment,
  comments: t.comments
    .filter((c) => staff || !c.is_internal)
    .map((c) => ({
      id: c.id,
      author: userBrief(find(db.users, c.author_id)),
      body: c.body,
      is_internal: c.is_internal,
      is_system: c.is_system,
      created_at: c.created_at,
    })),
})

export const effectiveStatus = (p: PassRec): S['PassRead']['status'] =>
  p.status === 'active' && new Date(p.valid_until) <= new Date() ? 'expired' : p.status

export const passRead = (db: DB, p: PassRec): S['PassRead'] => ({
  id: p.id,
  code: p.code,
  apartment: apartmentBrief(db, find(db.apartments, p.apartment_id)!),
  created_by: userBrief(find(db.users, p.created_by_id)),
  kind: p.kind,
  visitor_name: p.visitor_name,
  vehicle_plate: p.vehicle_plate,
  comment: p.comment,
  valid_from: p.valid_from,
  valid_until: p.valid_until,
  is_one_time: p.is_one_time,
  status: effectiveStatus(p),
  reviewed_at: p.reviewed_at,
  reject_reason: p.reject_reason,
  created_at: p.created_at,
})

export const passDetail = (db: DB, p: PassRec): S['PassDetail'] => ({
  ...passRead(db, p),
  visits: p.visits.map((v) => ({
    id: v.id,
    entered_at: v.entered_at,
    checked_by: userBrief(find(db.users, v.checked_by_id)),
    note: v.note,
  })),
})

export const announcementRead = (db: DB, a: AnnouncementRec): S['AnnouncementRead'] => ({
  id: a.id,
  title: a.title,
  body: a.body,
  building: a.building_id === null ? null : buildingBrief(db, a.building_id),
  is_pinned: a.is_pinned,
  published_at: a.published_at,
  created_at: a.created_at,
})
