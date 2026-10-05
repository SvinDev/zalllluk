/** Демо-данные — повторяют `python -m app.cli seed-demo` бэкенда. */
import type { MeterKind, PaymentMethod, TicketCategory, TicketPriority, TicketStatus } from '@/api/types'

import { balance, issueInvoice, reallocate, runBilling } from './billing'
import type { ApartmentRec, DB, MeterRec, TicketRec, UserRec } from './store'
import { addMonths, isoDate, periodBounds, periodOf, random, round } from './util'

export const DEMO_PASSWORD = 'demo12345'

const SURNAMES = [
  'Иванов', 'Смирнова', 'Кузнецов', 'Попова', 'Васильев', 'Петрова', 'Соколов', 'Михайлова',
  'Новиков', 'Фёдорова', 'Морозов', 'Волкова', 'Алексеев', 'Лебедева', 'Семёнов', 'Егорова',
]
const INITIALS = ['А. В.', 'Е. С.', 'Д. И.', 'О. Н.', 'С. П.', 'М. А.', 'И. Г.', 'Т. В.']
const SERIAL_PREFIX: Partial<Record<MeterKind, string>> = { cold_water: 'ХВ', hot_water: 'ГВ', electricity: 'ЭЛ' }
const MONTHLY_PER_PERSON: Partial<Record<MeterKind, number>> = { cold_water: 3.4, hot_water: 2.6, electricity: 85 }
const SLA_HOURS: Record<TicketPriority, number> = { emergency: 2, high: 24, normal: 72, low: 168 }

export function seed(): DB {
  const rnd = random(42)
  const now = new Date()
  const current = periodOf(now)
  const db: DB = {
    version: 1,
    seq: 0,
    users: [],
    buildings: [],
    apartments: [],
    meters: [],
    readings: [],
    tariffs: [],
    invoices: [],
    payments: [],
    tickets: [],
    passes: [],
    announcements: [],
    apiKeys: [],
    sources: [],
  }
  const id = () => ++db.seq
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString()

  const user = (email: string, full_name: string, role: UserRec['role'], phone: string | null = null) => {
    const u: UserRec = { id: id(), email, full_name, phone, role, password: DEMO_PASSWORD, is_active: true, created_at: ago(24 * 200) }
    db.users.push(u)
    return u
  }
  user('admin@demo.ru', 'Администратор УК', 'admin')
  const manager = user('manager@demo.ru', 'Ольга Диспетчерова', 'manager', '+7 900 100-00-01')
  user('buh@demo.ru', 'Марина Бухгалтерова', 'accountant')
  user('guard@demo.ru', 'Пост охраны', 'security')

  const buildings = [
    { id: id(), address: 'г. Москва, ул. Лесная, д. 12', floors: 9, entrances: 4, year_built: 1987, notes: null },
    { id: id(), address: 'г. Москва, ул. Садовая, д. 5, к. 2', floors: 17, entrances: 2, year_built: 2015, notes: null },
  ]
  db.buildings.push(...buildings)

  const validFrom = addMonths(current, -12)
  const tariff = (name: string, method: DB['tariffs'][number]['method'], rate: number, extra: Partial<DB['tariffs'][number]> = {}) =>
    db.tariffs.push({ id: id(), name, method, rate, meter_kind: null, normative: null, building_id: null, valid_from: validFrom, valid_to: null, ...extra })
  tariff('Содержание и ремонт жилого помещения', 'per_area', 32.8)
  tariff('Взнос на капитальный ремонт', 'per_area', 21.36)
  tariff('Обращение с ТКО', 'per_resident', 118.4)
  tariff('Холодное водоснабжение', 'metered', 52.82, { meter_kind: 'cold_water', normative: 4.9 })
  tariff('Горячее водоснабжение', 'metered', 248.51, { meter_kind: 'hot_water', normative: 3.6 })
  tariff('Электроснабжение', 'metered', 6.43, { meter_kind: 'electricity', normative: 100 })
  tariff('Домофон', 'fixed', 65)

  const apartments: ApartmentRec[] = []
  buildings.forEach((building, index) => {
    const count = index === 0 ? 12 : 8
    for (let n = 1; n <= count; n++) {
      apartments.push({
        id: id(),
        building_id: building.id,
        number: String(n),
        account_number: `${index + 1}${String(n).padStart(5, '0')}`,
        area: rnd.int(3200, 9800) / 100,
        residents_count: rnd.int(1, 4),
        owner_name: `${rnd.pick(SURNAMES)} ${rnd.pick(INITIALS)}`,
        resident_ids: [],
      })
    }
  })
  db.apartments.push(...apartments)

  const residents = [user('resident@demo.ru', 'Анна Жителева', 'resident', '+7 900 200-00-01')]
  for (let i = 1; i < 6; i++) residents.push(user(`resident${i}@demo.ru`, apartments[i].owner_name ?? '', 'resident'))
  residents.forEach((r, i) => apartments[i].resident_ids.push(r.id))

  const meters: MeterRec[] = []
  for (const apartment of apartments) {
    for (const kind of ['cold_water', 'hot_water', 'electricity'] as const) {
      meters.push({
        id: id(),
        apartment_id: apartment.id,
        kind,
        serial_number: `${SERIAL_PREFIX[kind]}-${apartment.account_number}`,
        external_id: kind === 'electricity' ? `iot-${apartment.account_number}-${kind}` : null,
        installed_at: '2021-03-01',
        verification_due: rnd.next() > 0.15 ? '2027-03-01' : isoDate(new Date(now.getTime() + rnd.int(5, 25) * 86400_000)),
        initial_value: rnd.int(10, 400),
        is_active: true,
      })
    }
  }
  db.meters.push(...meters)

  for (const meter of meters) {
    let value = meter.initial_value
    const people = apartments.find((a) => a.id === meter.apartment_id)!.residents_count
    const lazy = rnd.next() < 0.2
    for (let offset = 5; offset >= 0; offset--) {
      if ((offset === 0 || offset === 1 || offset === 2) && lazy) continue
      const [start] = periodBounds(addMonths(current, -offset))
      const day = offset === 0 ? Math.min(rnd.int(18, 25), Math.max(now.getDate() - 1, 1)) : rnd.int(18, 25)
      const takenAt = new Date(start.getFullYear(), start.getMonth(), day, 10)
      if (takenAt > now || (offset === 0 && now.getDate() < 2)) continue
      value = round(value + (MONTHLY_PER_PERSON[meter.kind] ?? 1) * people * (rnd.int(70, 130) / 100), 3)
      db.readings.push({
        id: id(),
        meter_id: meter.id,
        value,
        taken_at: takenAt.toISOString(),
        source: meter.kind === 'electricity' ? 'provider' : rnd.pick(['resident', 'resident', 'staff'] as const),
        submitted_by_id: null,
        created_at: takenAt.toISOString(),
      })
    }
  }

  // Пять закрытых месяцев: начисления, выставление и оплаты (есть и должники).
  for (let offset = 5; offset >= 1; offset--) {
    const period = addMonths(current, -offset)
    const [, end] = periodBounds(period)
    runBilling(db, period, null)
    for (const invoice of db.invoices.filter((i) => i.period === period && i.status === 'draft')) {
      issueInvoice(db, invoice, end.toISOString())
    }
    for (const apartment of apartments) {
      const behaviour = apartment.id % 7
      if (behaviour === 0) continue
      const debt = balance(db, apartment.id).balance
      if (debt <= 0) continue
      const paidAt = new Date(end.getTime() + (rnd.int(2, 9) * 24 + 12) * 3600_000)
      db.payments.push({
        id: id(),
        apartment_id: apartment.id,
        amount: behaviour === 3 ? round(debt / 2) : debt,
        paid_at: (paidAt > now ? now : paidAt).toISOString(),
        method: rnd.pick(['bank', 'card', 'cash', 'other'] as PaymentMethod[]),
        reference: `DEMO-${period.slice(0, 7)}-${apartment.account_number}`,
        comment: null,
        created_at: paidAt.toISOString(),
      })
      reallocate(db, apartment.id)
    }
  }
  runBilling(db, current, null)

  const specs: [number, TicketCategory, TicketPriority, TicketStatus, string, string, number][] = [
    [0, 'plumbing', 'high', 'in_progress', 'Течёт стояк в ванной', 'Подтекает соединение на стояке ГВС, под ванной лужа.', 1],
    [1, 'elevator', 'emergency', 'new', 'Не работает лифт во 2 подъезде', 'Лифт стоит на 5 этаже, двери не открываются.', 0],
    [2, 'cleaning', 'low', 'resolved', 'Не убрана лестничная клетка', 'На 3 этаже второй день не моют полы.', 4],
    [3, 'intercom', 'normal', 'waiting', 'Не работает домофон', 'Трубка в квартире молчит, звонок с улицы не проходит.', 2],
    [14, 'territory', 'normal', 'closed', 'Яма во дворе', 'Возле второго подъезда провал асфальта.', 9],
    [4, 'heating', 'high', 'new', 'Холодные батареи', 'В квартире +17, батареи едва тёплые.', 0],
  ]
  for (const [index, category, priority, status, subject, description, daysAgo] of specs) {
    const apartment = apartments[index]
    const author = index < residents.length ? residents[index] : manager
    const created = new Date(now.getTime() - (daysAgo * 24 + rnd.int(1, 10)) * 3600_000)
    const ticket: TicketRec = {
      id: id(),
      building_id: apartment.building_id,
      apartment_id: apartment.id,
      author_id: author.id,
      assignee_id: status === 'new' ? null : manager.id,
      category,
      priority,
      status,
      subject,
      description,
      due_at: new Date(created.getTime() + SLA_HOURS[priority] * 3600_000).toISOString(),
      resolved_at: status === 'resolved' || status === 'closed' ? new Date(created.getTime() + 86400_000).toISOString() : null,
      closed_at: status === 'closed' ? new Date(created.getTime() + 2 * 86400_000).toISOString() : null,
      rating: status === 'closed' ? 5 : null,
      rating_comment: null,
      created_at: created.toISOString(),
      updated_at: created.toISOString(),
      comments:
        status === 'new'
          ? []
          : [{ id: id(), author_id: author.id, body: 'Прошу решить как можно скорее.', is_internal: false, is_system: false, created_at: created.toISOString() }],
    }
    db.tickets.push(ticket)
  }

  const hours = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString()
  const pass = (p: Partial<DB['passes'][number]> & Pick<DB['passes'][number], 'code' | 'apartment_id' | 'kind'>) =>
    db.passes.push({
      id: id(),
      created_by_id: residents[0].id,
      visitor_name: null,
      vehicle_plate: null,
      comment: null,
      valid_from: hours(0),
      valid_until: hours(24),
      is_one_time: true,
      status: 'active',
      reviewed_at: null,
      reject_reason: null,
      created_at: hours(-1),
      visits: [],
      ...p,
    })
  pass({ code: 'GST7K2', apartment_id: apartments[0].id, kind: 'guest', visitor_name: 'Сергей Гостев', valid_from: hours(-1), valid_until: hours(10) })
  pass({ code: 'CAR4M9', apartment_id: apartments[0].id, kind: 'vehicle', visitor_name: 'Родители', vehicle_plate: 'А123ВС777', valid_until: hours(24 * 30), is_one_time: false, status: 'pending' })
  pass({ code: 'DLV8P3', apartment_id: apartments[2].id, created_by_id: residents[2].id, kind: 'delivery', visitor_name: 'Доставка мебели', vehicle_plate: 'Х555ХХ199', valid_from: hours(24), valid_until: hours(30) })

  const announce = (title: string, body: string, building_id: number | null, is_pinned = false) =>
    db.announcements.push({ id: id(), title, body, building_id, is_pinned, published_at: ago(2), created_at: ago(2) })
  announce('Плановое отключение горячей воды', 'С 10:00 до 18:00 в связи с ремонтом теплотрассы будет отключена горячая вода. Приносим извинения за неудобства.', buildings[0].id, true)
  announce('Передайте показания счётчиков до 25 числа', 'Показания можно передать в личном кабинете в разделе «Счётчики». Если показания не переданы, начисление будет по нормативу.', null)
  announce('Общее собрание собственников', 'Приглашаем на общее собрание собственников во дворе дома в субботу в 12:00.', buildings[1].id)

  db.apiKeys.push({ id: id(), name: 'Демо: шлюз АСКУЭ', prefix: 'd3m0a5c1', is_active: true, created_at: ago(24 * 30), last_used_at: ago(3) })
  return db
}
