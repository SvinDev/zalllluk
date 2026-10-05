/**
 * Эмуляция REST API в браузере для демо-сборки (GitHub Pages).
 * Повторяет контракт и основные бизнес-правила бэкенда; данные — в localStorage.
 */
import type { UserRole } from '@/api/types'

import { balance, issueInvoice, reallocate, runBilling } from './billing'
import * as ser from './serializers'
import { db as getDb, type DB, persist, type PassRec, type TicketRec, type UserRec } from './store'
import { addMonths, isoDate, money, nextId, normalizePlate, nowIso, parsePeriod, periodBounds, periodOf, round } from './util'

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    readonly code = 'business_rule',
  ) {
    super(detail)
  }
}
const notFound = (message: string) => new ApiError(404, message, 'not_found')
const forbidden = () => new ApiError(403, 'Недостаточно прав для этого действия', 'forbidden')
const rule = (detail: string) => new ApiError(422, detail)

type Ctx = {
  db: DB
  user: UserRec | null
  params: Record<string, number>
  query: URLSearchParams
  body: Record<string, unknown>
}
type Handler = (ctx: Ctx) => unknown
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler; public?: boolean }

const routes: Route[] = []
function route(method: string, path: string, handler: Handler, isPublic = false) {
  const keys: string[] = []
  const pattern = new RegExp(
    `^/api/v1${path.replace(/\{(\w+)\}/g, (_, key: string) => {
      keys.push(key)
      return '(\\d+)'
    })}$`,
  )
  routes.push({ method, pattern, keys, handler, public: isPublic })
}

// ---------- Помощники доступа ----------

const STAFF: UserRole[] = ['admin', 'manager', 'accountant', 'security']
const isStaff = (u: UserRec) => STAFF.includes(u.role)
function need(ctx: Ctx, ...roles: UserRole[]): UserRec {
  const user = ctx.user!
  if (!roles.includes(user.role)) throw forbidden()
  return user
}
const MANAGERS: UserRole[] = ['admin', 'manager']
const ACCOUNTANTS: UserRole[] = ['admin', 'accountant']
const GUARDS: UserRole[] = ['admin', 'manager', 'security']
const HOUSEHOLD: UserRole[] = ['admin', 'manager', 'accountant', 'resident']

/** null — сотруднику доступны все помещения. */
const ownApartments = (ctx: Ctx): number[] | null =>
  isStaff(ctx.user!) ? null : ctx.db.apartments.filter((a) => a.resident_ids.includes(ctx.user!.id)).map((a) => a.id)
const canSee = (ctx: Ctx, apartmentId: number | null) => {
  const ids = ownApartments(ctx)
  return ids === null || (apartmentId !== null && ids.includes(apartmentId))
}
function apartmentOf(ctx: Ctx, id: number) {
  const a = ctx.db.apartments.find((x) => x.id === id)
  if (!a || !canSee(ctx, id)) throw new ApiError(404, 'Помещение не найдено', 'not_found')
  return a
}

const num = (ctx: Ctx, key: string) => (ctx.query.get(key) ? Number(ctx.query.get(key)) : null)
const str = (ctx: Ctx, key: string) => ctx.query.get(key) || null
const bool = (ctx: Ctx, key: string) => ctx.query.get(key) === 'true'
const has = (text: string | null | undefined, search: string | null) =>
  !search || (text ?? '').toLowerCase().includes(search.trim().toLowerCase())

function page<T>(ctx: Ctx, items: T[]) {
  const limit = num(ctx, 'limit') ?? 50
  const offset = num(ctx, 'offset') ?? 0
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset }
}
const byNumber = (a: { number: string }, b: { number: string }) =>
  a.number.length - b.number.length || a.number.localeCompare(b.number)

// ---------- Авторизация и пользователи ----------

route(
  'POST',
  '/auth/login',
  ({ db, body }) => {
    const user = db.users.find((u) => u.email === String(body.email).trim().toLowerCase())
    if (!user || user.password !== body.password) throw new ApiError(401, 'Неверный email или пароль', 'unauthorized')
    if (!user.is_active) throw new ApiError(401, 'Учётная запись заблокирована', 'unauthorized')
    return { access_token: `demo.${user.id}`, token_type: 'bearer', expires_in: 43200, user: ser.userRead(user) }
  },
  true,
)
route('GET', '/auth/me', ({ db, user }) => ({
  ...ser.userRead(user!),
  apartments: db.apartments.filter((a) => a.resident_ids.includes(user!.id)).map((a) => ser.apartmentRead(db, a)),
}))
route('POST', '/auth/change-password', ({ user, body }) => {
  if (user!.password !== body.current_password) throw rule('Текущий пароль указан неверно')
  user!.password = String(body.new_password)
  return null
})

route('GET', '/users', (ctx) => {
  need(ctx, ...MANAGERS)
  const role = str(ctx, 'role')
  const search = str(ctx, 'search')
  const items = ctx.db.users
    .filter((u) => (!role || u.role === role) && (has(u.full_name, search) || has(u.email, search) || has(u.phone, search)))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
  return page(ctx, items.map(ser.userRead))
})
route('POST', '/users', (ctx) => {
  const actor = need(ctx, ...MANAGERS)
  const role = (ctx.body.role as UserRole) ?? 'resident'
  if (actor.role !== 'admin' && role !== 'resident') throw forbidden()
  const email = String(ctx.body.email).trim().toLowerCase()
  if (ctx.db.users.some((u) => u.email === email)) throw new ApiError(409, 'Пользователь с таким email уже существует', 'conflict')
  const user: UserRec = {
    id: nextId(ctx.db),
    email,
    full_name: String(ctx.body.full_name),
    phone: (ctx.body.phone as string) || null,
    role,
    password: String(ctx.body.password),
    is_active: true,
    created_at: nowIso(),
  }
  ctx.db.users.push(user)
  return ser.userRead(user)
})
route('PATCH', '/users/{user_id}', (ctx) => {
  const actor = need(ctx, ...MANAGERS)
  const user = ctx.db.users.find((u) => u.id === ctx.params.user_id)
  if (!user) throw notFound('Пользователь не найден')
  if (actor.role !== 'admin' && user.role !== 'resident') throw forbidden()
  const { password, ...changes } = ctx.body
  if (user.id === actor.id && (changes.is_active === false || (changes.role && changes.role !== actor.role))) {
    throw forbidden()
  }
  Object.assign(user, changes)
  if (password) user.password = String(password)
  return ser.userRead(user)
})

// ---------- Жилфонд ----------

route('GET', '/buildings', (ctx) => {
  const ids = ownApartments(ctx)
  const buildingIds = ids && new Set(ctx.db.apartments.filter((a) => ids.includes(a.id)).map((a) => a.building_id))
  const search = str(ctx, 'search')
  const items = ctx.db.buildings
    .filter((b) => (!buildingIds || buildingIds.has(b.id)) && has(b.address, search))
    .sort((a, b) => a.address.localeCompare(b.address))
  return page(ctx, items.map((b) => ser.buildingRead(ctx.db, b.id)))
})
route('GET', '/buildings/{building_id}', (ctx) => {
  if (!ctx.db.buildings.some((b) => b.id === ctx.params.building_id)) throw notFound('Дом не найден')
  return ser.buildingRead(ctx.db, ctx.params.building_id)
})
route('POST', '/buildings', (ctx) => {
  need(ctx, ...MANAGERS)
  const id = nextId(ctx.db)
  ctx.db.buildings.push({ id, address: String(ctx.body.address), floors: null, entrances: null, year_built: null, notes: null, ...ctx.body })
  return ser.buildingRead(ctx.db, id)
})
route('PATCH', '/buildings/{building_id}', (ctx) => {
  need(ctx, ...MANAGERS)
  const b = ctx.db.buildings.find((x) => x.id === ctx.params.building_id)
  if (!b) throw notFound('Дом не найден')
  Object.assign(b, ctx.body)
  return ser.buildingRead(ctx.db, b.id)
})
route('DELETE', '/buildings/{building_id}', (ctx) => {
  need(ctx, ...MANAGERS)
  if (ctx.db.apartments.some((a) => a.building_id === ctx.params.building_id)) {
    throw new ApiError(409, 'Нельзя удалить дом, в котором есть помещения', 'conflict')
  }
  ctx.db.buildings = ctx.db.buildings.filter((b) => b.id !== ctx.params.building_id)
  return null
})

route('GET', '/apartments', (ctx) => {
  const ids = ownApartments(ctx)
  const buildingId = num(ctx, 'building_id')
  const search = str(ctx, 'search')
  const items = ctx.db.apartments
    .filter(
      (a) =>
        (!ids || ids.includes(a.id)) &&
        (!buildingId || a.building_id === buildingId) &&
        (has(a.number, search) ||
          has(a.account_number, search) ||
          has(a.owner_name, search) ||
          has(ser.buildingBrief(ctx.db, a.building_id).address, search)),
    )
    .sort((a, b) => a.building_id - b.building_id || byNumber(a, b))
  return page(ctx, items.map((a) => ser.apartmentRead(ctx.db, a)))
})
route('GET', '/apartments/{apartment_id}', (ctx) => ser.apartmentDetail(ctx.db, apartmentOf(ctx, ctx.params.apartment_id)))
route('POST', '/apartments', (ctx) => {
  need(ctx, ...MANAGERS)
  const b = ctx.body
  if (ctx.db.apartments.some((a) => a.account_number === b.account_number)) {
    throw new ApiError(409, `Лицевой счёт ${String(b.account_number)} уже занят`, 'conflict')
  }
  const apartment = {
    id: nextId(ctx.db),
    building_id: Number(b.building_id),
    number: String(b.number),
    account_number: String(b.account_number),
    area: Number(b.area),
    residents_count: Number(b.residents_count ?? 0),
    owner_name: (b.owner_name as string) ?? null,
    resident_ids: [],
  }
  ctx.db.apartments.push(apartment)
  return ser.apartmentDetail(ctx.db, apartment)
})
route('PATCH', '/apartments/{apartment_id}', (ctx) => {
  need(ctx, ...MANAGERS)
  const a = apartmentOf(ctx, ctx.params.apartment_id)
  Object.assign(a, ctx.body, ctx.body.area !== undefined ? { area: Number(ctx.body.area) } : {})
  return ser.apartmentDetail(ctx.db, a)
})
route('POST', '/apartments/{apartment_id}/residents', (ctx) => {
  need(ctx, ...MANAGERS)
  const a = apartmentOf(ctx, ctx.params.apartment_id)
  const user = ctx.db.users.find((u) => u.id === Number(ctx.body.user_id))
  if (!user) throw notFound('Пользователь не найден')
  if (user.role !== 'resident') throw rule('Привязать к помещению можно только пользователя-жителя')
  if (!a.resident_ids.includes(user.id)) a.resident_ids.push(user.id)
  return ser.apartmentDetail(ctx.db, a)
})
route('DELETE', '/apartments/{apartment_id}/residents/{user_id}', (ctx) => {
  need(ctx, ...MANAGERS)
  const a = apartmentOf(ctx, ctx.params.apartment_id)
  a.resident_ids = a.resident_ids.filter((id) => id !== ctx.params.user_id)
  return ser.apartmentDetail(ctx.db, a)
})

// ---------- Счётчики и показания ----------

function meterOf(ctx: Ctx, id: number) {
  const m = ctx.db.meters.find((x) => x.id === id)
  if (!m || !canSee(ctx, m.apartment_id)) throw new ApiError(404, 'Счётчик не найден', 'not_found')
  return m
}

route('GET', '/meters', (ctx) => {
  need(ctx, ...HOUSEHOLD)
  const ids = ownApartments(ctx)
  const [apartmentId, buildingId] = [num(ctx, 'apartment_id'), num(ctx, 'building_id')]
  const kind = str(ctx, 'kind')
  const search = str(ctx, 'search')
  const dueBefore = str(ctx, 'verification_due_before')
  const noReadingSince = str(ctx, 'no_reading_since')
  const since = noReadingSince ? new Date(`${noReadingSince}T00:00:00`) : null
  const items = ctx.db.meters.filter((m) => {
    const a = ctx.db.apartments.find((x) => x.id === m.apartment_id)!
    return (
      (!ids || ids.includes(m.apartment_id)) &&
      (!apartmentId || m.apartment_id === apartmentId) &&
      (!buildingId || a.building_id === buildingId) &&
      (!kind || m.kind === kind) &&
      (ctx.query.get('is_active') === null || m.is_active === bool(ctx, 'is_active')) &&
      (has(m.serial_number, search) || has(m.external_id, search) || has(a.account_number, search)) &&
      (!dueBefore || (m.verification_due !== null && m.verification_due <= dueBefore)) &&
      (!since || !ctx.db.readings.some((r) => r.meter_id === m.id && new Date(r.taken_at) >= since))
    )
  })
  return page(ctx, items.map((m) => ser.meterRead(ctx.db, m)))
})
route('GET', '/meters/{meter_id}', (ctx) => {
  need(ctx, ...HOUSEHOLD)
  return ser.meterRead(ctx.db, meterOf(ctx, ctx.params.meter_id))
})
route('POST', '/meters', (ctx) => {
  need(ctx, ...MANAGERS)
  const b = ctx.body
  if (ctx.db.meters.some((m) => m.serial_number === b.serial_number)) {
    throw new ApiError(409, `Счётчик с серийным номером ${String(b.serial_number)} уже зарегистрирован`, 'conflict')
  }
  const meter = {
    id: nextId(ctx.db),
    apartment_id: Number(b.apartment_id),
    kind: b.kind as DB['meters'][number]['kind'],
    serial_number: String(b.serial_number),
    external_id: (b.external_id as string) ?? null,
    installed_at: (b.installed_at as string) ?? null,
    verification_due: (b.verification_due as string) ?? null,
    initial_value: Number(b.initial_value ?? 0),
    is_active: true,
  }
  ctx.db.meters.push(meter)
  return ser.meterRead(ctx.db, meter)
})
route('GET', '/meters/{meter_id}/readings', (ctx) => {
  need(ctx, ...HOUSEHOLD)
  const m = meterOf(ctx, ctx.params.meter_id)
  const consumption = ser.consumptionMap(ctx.db)
  const items = ctx.db.readings
    .filter((r) => r.meter_id === m.id)
    .sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))
  return page(ctx, items.map((r) => ser.readingRead(r, consumption.get(r.id))))
})
route('POST', '/meters/{meter_id}/readings', (ctx) => {
  const user = need(ctx, ...HOUSEHOLD)
  const m = meterOf(ctx, ctx.params.meter_id)
  const value = Number(ctx.body.value)
  // Житель передаёт показания «на сейчас», дату может указать только сотрудник.
  const takenAt = isStaff(user) && ctx.body.taken_at ? new Date(String(ctx.body.taken_at)) : new Date()
  if (!m.is_active) throw rule('Счётчик выведен из эксплуатации')
  if (takenAt.getTime() > Date.now() + 5 * 60_000) throw rule('Дата показаний не может быть в будущем')
  const readings = ctx.db.readings.filter((r) => r.meter_id === m.id)
  const previous = readings
    .filter((r) => new Date(r.taken_at) < takenAt)
    .sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0]
  const floor = previous?.value ?? m.initial_value
  if (value < floor) throw rule(`Показание ${value} меньше предыдущего (${floor})`)
  const following = readings
    .filter((r) => new Date(r.taken_at) > takenAt)
    .sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1))[0]
  if (following && value > following.value) throw rule(`Показание ${value} больше последующего (${following.value})`)
  const reading = {
    id: nextId(ctx.db),
    meter_id: m.id,
    value,
    taken_at: takenAt.toISOString(),
    source: isStaff(user) ? ('staff' as const) : ('resident' as const),
    submitted_by_id: user.id,
    created_at: nowIso(),
  }
  ctx.db.readings.push(reading)
  return ser.readingRead(reading, value - floor)
})
route('GET', '/readings', (ctx) => {
  need(ctx, ...STAFF)
  const [buildingId, kind, source] = [num(ctx, 'building_id'), str(ctx, 'kind'), str(ctx, 'source')]
  const from = str(ctx, 'date_from')
  const to = str(ctx, 'date_to')
  const consumption = ser.consumptionMap(ctx.db)
  const items = ctx.db.readings
    .filter((r) => {
      const m = ctx.db.meters.find((x) => x.id === r.meter_id)!
      const a = ctx.db.apartments.find((x) => x.id === m.apartment_id)!
      const day = isoDate(new Date(r.taken_at))
      return (
        (!buildingId || a.building_id === buildingId) &&
        (!kind || m.kind === kind) &&
        (!source || r.source === source) &&
        (!from || day >= from) &&
        (!to || day <= to)
      )
    })
    .sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))
  return page(ctx, items.map((r) => ser.journalItem(ctx.db, r, consumption.get(r.id))))
})
route('DELETE', '/readings/{reading_id}', (ctx) => {
  need(ctx, ...MANAGERS)
  ctx.db.readings = ctx.db.readings.filter((r) => r.id !== ctx.params.reading_id)
  return null
})

// ---------- Тарифы и начисления ----------

route('GET', '/tariffs', (ctx) => {
  need(ctx, ...STAFF)
  const activeOn = str(ctx, 'active_on')
  return ctx.db.tariffs
    .filter((t) => !activeOn || (t.valid_from <= activeOn && (!t.valid_to || t.valid_to >= activeOn)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(ser.tariffRead)
})
route('POST', '/tariffs', (ctx) => {
  need(ctx, ...ACCOUNTANTS)
  const b = ctx.body
  if (b.method === 'metered' && !b.meter_kind) throw rule('Для услуги по счётчику укажите тип счётчика')
  const tariff = {
    id: nextId(ctx.db),
    name: String(b.name),
    method: b.method as DB['tariffs'][number]['method'],
    meter_kind: (b.meter_kind as DB['tariffs'][number]['meter_kind']) ?? null,
    rate: Number(b.rate),
    normative: b.normative == null ? null : Number(b.normative),
    building_id: (b.building_id as number) ?? null,
    valid_from: String(b.valid_from),
    valid_to: (b.valid_to as string) ?? null,
  }
  ctx.db.tariffs.push(tariff)
  return ser.tariffRead(tariff)
})
route('PATCH', '/tariffs/{tariff_id}', (ctx) => {
  need(ctx, ...ACCOUNTANTS)
  const t = ctx.db.tariffs.find((x) => x.id === ctx.params.tariff_id)
  if (!t) throw notFound('Тариф не найден')
  const b = ctx.body
  if (b.name !== undefined) t.name = String(b.name)
  if (b.rate !== undefined) t.rate = Number(b.rate)
  if (b.normative !== undefined) t.normative = b.normative === null ? null : Number(b.normative)
  if (b.valid_to !== undefined) t.valid_to = (b.valid_to as string) ?? null
  return ser.tariffRead(t)
})

route('POST', '/billing/run', (ctx) => {
  need(ctx, ...ACCOUNTANTS)
  const period = parsePeriod(String(ctx.body.period))!
  if (period > periodOf(new Date())) throw rule('Нельзя начислять за будущий период')
  const r = runBilling(ctx.db, period, (ctx.body.building_id as number) ?? null)
  return {
    period,
    created: r.created,
    regenerated: r.regenerated,
    skipped_posted: r.skipped_posted,
    without_charges: r.without_charges,
    total_amount: money(r.total),
  }
})
route('POST', '/billing/issue', (ctx) => {
  need(ctx, ...ACCOUNTANTS)
  const period = parsePeriod(String(ctx.body.period))
  const buildingId = (ctx.body.building_id as number) ?? null
  const drafts = ctx.db.invoices.filter(
    (i) =>
      i.period === period &&
      i.status === 'draft' &&
      (!buildingId || ctx.db.apartments.find((a) => a.id === i.apartment_id)!.building_id === buildingId),
  )
  drafts.forEach((i) => issueInvoice(ctx.db, i))
  return { issued: drafts.length }
})
route('GET', '/billing/accounts/{apartment_id}', (ctx) => {
  need(ctx, ...HOUSEHOLD)
  const a = apartmentOf(ctx, ctx.params.apartment_id)
  const b = balance(ctx.db, a.id)
  return { apartment_id: a.id, charged: money(b.charged), paid: money(b.paid), balance: money(b.balance), last_payment_at: b.last_payment_at }
})
route('GET', '/billing/debtors', (ctx) => {
  need(ctx, ...STAFF)
  const buildingId = num(ctx, 'building_id')
  const minDebt = num(ctx, 'min_debt') ?? 0
  const rows = ctx.db.apartments
    .filter((a) => !buildingId || a.building_id === buildingId)
    .map((a) => ({ a, b: balance(ctx.db, a.id) }))
    .filter(({ b }) => b.balance > minDebt)
    .sort((x, y) => y.b.balance - x.b.balance)
  return page(
    ctx,
    rows.map(({ a, b }) => ({
      apartment: ser.apartmentBrief(ctx.db, a),
      owner_name: a.owner_name,
      balance: money(b.balance),
      last_payment_at: b.last_payment_at,
    })),
  )
})

function invoiceOf(ctx: Ctx, id: number) {
  const i = ctx.db.invoices.find((x) => x.id === id)
  if (!i || !canSee(ctx, i.apartment_id) || (!isStaff(ctx.user!) && i.status === 'draft')) {
    throw new ApiError(404, 'Квитанция не найдена', 'not_found')
  }
  return i
}
route('GET', '/invoices', (ctx) => {
  need(ctx, ...HOUSEHOLD)
  const ids = ownApartments(ctx)
  const period = parsePeriod(str(ctx, 'period'))
  const [status, search] = [str(ctx, 'status'), str(ctx, 'search')]
  const [buildingId, apartmentId] = [num(ctx, 'building_id'), num(ctx, 'apartment_id')]
  const items = ctx.db.invoices
    .filter((i) => {
      const a = ctx.db.apartments.find((x) => x.id === i.apartment_id)!
      return (
        (!ids || (ids.includes(i.apartment_id) && i.status !== 'draft')) &&
        (!period || i.period === period) &&
        (!status || i.status === status) &&
        (!buildingId || a.building_id === buildingId) &&
        (!apartmentId || i.apartment_id === apartmentId) &&
        (has(i.number, search) || has(a.account_number, search))
      )
    })
    .sort((a, b) => (a.period === b.period ? b.id - a.id : a.period < b.period ? 1 : -1))
  return page(ctx, items.map((i) => ser.invoiceRead(ctx.db, i)))
})
route('GET', '/invoices/{invoice_id}', (ctx) => {
  need(ctx, ...HOUSEHOLD)
  return ser.invoiceDetail(ctx.db, invoiceOf(ctx, ctx.params.invoice_id))
})
route('POST', '/invoices/{invoice_id}/issue', (ctx) => {
  need(ctx, ...ACCOUNTANTS)
  const i = invoiceOf(ctx, ctx.params.invoice_id)
  if (i.status !== 'draft') throw rule('Выставить можно только черновик')
  issueInvoice(ctx.db, i)
  return ser.invoiceDetail(ctx.db, i)
})
route('POST', '/invoices/{invoice_id}/cancel', (ctx) => {
  need(ctx, ...ACCOUNTANTS)
  const i = invoiceOf(ctx, ctx.params.invoice_id)
  if (i.status === 'cancelled') throw rule('Квитанция уже аннулирована')
  if (i.status === 'draft') ctx.db.invoices = ctx.db.invoices.filter((x) => x.id !== i.id)
  else {
    i.status = 'cancelled'
    i.paid_amount = 0
    reallocate(ctx.db, i.apartment_id)
  }
  return null
})

route('GET', '/payments', (ctx) => {
  need(ctx, ...HOUSEHOLD)
  const ids = ownApartments(ctx)
  const [apartmentId, buildingId] = [num(ctx, 'apartment_id'), num(ctx, 'building_id')]
  const [from, to] = [str(ctx, 'date_from'), str(ctx, 'date_to')]
  const items = ctx.db.payments
    .filter((p) => {
      const a = ctx.db.apartments.find((x) => x.id === p.apartment_id)!
      const day = isoDate(new Date(p.paid_at))
      return (
        (!ids || ids.includes(p.apartment_id)) &&
        (!apartmentId || p.apartment_id === apartmentId) &&
        (!buildingId || a.building_id === buildingId) &&
        (!from || day >= from) &&
        (!to || day <= to)
      )
    })
    .sort((a, b) => (a.paid_at < b.paid_at ? 1 : -1))
  return page(ctx, items.map((p) => ser.paymentRead(ctx.db, p)))
})
route('POST', '/payments', (ctx) => {
  need(ctx, ...ACCOUNTANTS)
  const b = ctx.body
  const apartment = b.apartment_id
    ? ctx.db.apartments.find((a) => a.id === Number(b.apartment_id))
    : ctx.db.apartments.find((a) => a.account_number === b.account_number)
  if (!apartment) throw new ApiError(404, 'Лицевой счёт не найден', 'not_found')
  if (b.reference && ctx.db.payments.some((p) => p.reference === b.reference)) {
    throw new ApiError(409, `Платёж с номером ${String(b.reference)} уже учтён`, 'conflict')
  }
  const payment = {
    id: nextId(ctx.db),
    apartment_id: apartment.id,
    amount: round(Number(b.amount)),
    paid_at: (b.paid_at as string) ?? nowIso(),
    method: (b.method as DB['payments'][number]['method']) ?? 'bank',
    reference: (b.reference as string) ?? null,
    comment: (b.comment as string) ?? null,
    created_at: nowIso(),
  }
  ctx.db.payments.push(payment)
  reallocate(ctx.db, apartment.id)
  return ser.paymentRead(ctx.db, payment)
})

// ---------- Заявки ----------

const SLA_HOURS = { emergency: 2, high: 24, normal: 72, low: 168 }
const STATUS_LABELS: Record<TicketRec['status'], string> = {
  new: 'Новая',
  in_progress: 'В работе',
  waiting: 'Ожидает',
  resolved: 'Выполнена',
  closed: 'Закрыта',
  rejected: 'Отклонена',
}
const STAFF_TRANSITIONS: Record<string, string[]> = {
  new: ['in_progress', 'waiting', 'resolved', 'rejected', 'closed'],
  in_progress: ['waiting', 'resolved', 'rejected'],
  waiting: ['in_progress', 'resolved', 'rejected'],
  resolved: ['closed', 'in_progress'],
}
const RESIDENT_TRANSITIONS: Record<string, string[]> = { new: ['closed'], resolved: ['closed', 'in_progress'] }

function ticketOf(ctx: Ctx, id: number) {
  const t = ctx.db.tickets.find((x) => x.id === id)
  if (!t || !(canSee(ctx, t.apartment_id) || t.author_id === ctx.user!.id)) {
    throw new ApiError(404, 'Заявка не найдена', 'not_found')
  }
  return t
}
function system(ctx: Ctx, t: TicketRec, body: string) {
  t.comments.push({ id: nextId(ctx.db), author_id: ctx.user!.id, body, is_internal: false, is_system: true, created_at: nowIso() })
  t.updated_at = nowIso()
}
const detail = (ctx: Ctx, t: TicketRec) => ser.ticketDetail(ctx.db, t, isStaff(ctx.user!))

route('GET', '/tickets', (ctx) => {
  const ids = ownApartments(ctx)
  const statuses = ctx.query.getAll('status')
  const [category, priority, search] = [str(ctx, 'category'), str(ctx, 'priority'), str(ctx, 'search')]
  const [buildingId, apartmentId, assigneeId] = [num(ctx, 'building_id'), num(ctx, 'apartment_id'), num(ctx, 'assignee_id')]
  const items = ctx.db.tickets
    .filter(
      (t) =>
        (!ids || (t.apartment_id !== null && ids.includes(t.apartment_id)) || t.author_id === ctx.user!.id) &&
        (!statuses.length || statuses.includes(t.status)) &&
        (!bool(ctx, 'only_open') || ['new', 'in_progress', 'waiting'].includes(t.status)) &&
        (!bool(ctx, 'overdue') || ser.isOverdue(t)) &&
        (!category || t.category === category) &&
        (!priority || t.priority === priority) &&
        (!buildingId || t.building_id === buildingId) &&
        (!apartmentId || t.apartment_id === apartmentId) &&
        (!assigneeId || t.assignee_id === assigneeId) &&
        (has(t.subject, search) || has(t.description, search)),
    )
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  return page(ctx, items.map((t) => ser.ticketRead(ctx.db, t)))
})
route('POST', '/tickets', (ctx) => {
  const b = ctx.body
  let buildingId: number
  if (b.apartment_id) buildingId = apartmentOf(ctx, Number(b.apartment_id)).building_id
  else if (isStaff(ctx.user!) && b.building_id) buildingId = Number(b.building_id)
  else throw rule('Укажите помещение, к которому относится заявка')
  const priority = (b.priority as TicketRec['priority']) ?? 'normal'
  const now = new Date()
  const ticket: TicketRec = {
    id: nextId(ctx.db),
    building_id: buildingId,
    apartment_id: (b.apartment_id as number) ?? null,
    author_id: ctx.user!.id,
    assignee_id: null,
    category: b.category as TicketRec['category'],
    priority,
    status: 'new',
    subject: String(b.subject),
    description: String(b.description),
    due_at: new Date(now.getTime() + SLA_HOURS[priority] * 3600_000).toISOString(),
    resolved_at: null,
    closed_at: null,
    rating: null,
    rating_comment: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    comments: [],
  }
  ctx.db.tickets.push(ticket)
  return detail(ctx, ticket)
})
route('GET', '/tickets/{ticket_id}', (ctx) => detail(ctx, ticketOf(ctx, ctx.params.ticket_id)))
route('PATCH', '/tickets/{ticket_id}', (ctx) => {
  need(ctx, ...MANAGERS)
  const t = ticketOf(ctx, ctx.params.ticket_id)
  const b = ctx.body
  if ('assignee_id' in b && b.assignee_id !== t.assignee_id) {
    if (b.assignee_id === null) system(ctx, t, 'Исполнитель снят')
    else {
      const assignee = ctx.db.users.find((u) => u.id === Number(b.assignee_id))
      if (!assignee || !isStaff(assignee)) throw rule('Исполнителем может быть только активный сотрудник УК')
      system(ctx, t, `Назначен исполнитель: ${assignee.full_name}`)
      if (t.status === 'new') {
        t.status = 'in_progress'
        system(ctx, t, 'Статус: Новая → В работе')
      }
    }
    t.assignee_id = (b.assignee_id as number) ?? null
  }
  if (b.priority && b.priority !== t.priority) {
    t.priority = b.priority as TicketRec['priority']
    t.due_at = new Date(new Date(t.created_at).getTime() + SLA_HOURS[t.priority] * 3600_000).toISOString()
  }
  if (b.category) t.category = b.category as TicketRec['category']
  if (b.subject) t.subject = String(b.subject)
  return detail(ctx, t)
})
route('POST', '/tickets/{ticket_id}/status', (ctx) => {
  const t = ticketOf(ctx, ctx.params.ticket_id)
  const target = ctx.body.status as TicketRec['status']
  const comment = (ctx.body.comment as string) || ''
  const allowed = (isStaff(ctx.user!) ? STAFF_TRANSITIONS : RESIDENT_TRANSITIONS)[t.status] ?? []
  if (!allowed.includes(target)) {
    if (!isStaff(ctx.user!) && (STAFF_TRANSITIONS[t.status] ?? []).includes(target)) throw forbidden()
    throw rule(`Нельзя перевести заявку из «${STATUS_LABELS[t.status]}» в «${STATUS_LABELS[target]}»`)
  }
  if (target === 'rejected' && !comment) throw rule('Укажите причину отклонения')
  const previous = t.status
  t.status = target
  if (target === 'resolved') t.resolved_at = nowIso()
  if (target === 'in_progress' && previous === 'resolved') t.resolved_at = null
  if (target === 'closed' || target === 'rejected') t.closed_at = nowIso()
  system(ctx, t, `Статус: ${STATUS_LABELS[previous]} → ${STATUS_LABELS[target]}${comment ? `. ${comment}` : ''}`)
  return detail(ctx, t)
})
route('POST', '/tickets/{ticket_id}/comments', (ctx) => {
  const t = ticketOf(ctx, ctx.params.ticket_id)
  if (t.status === 'closed' || t.status === 'rejected') throw rule('Заявка закрыта — комментарии недоступны')
  const staff = isStaff(ctx.user!)
  t.comments.push({
    id: nextId(ctx.db),
    author_id: ctx.user!.id,
    body: String(ctx.body.body),
    is_internal: staff && Boolean(ctx.body.is_internal),
    is_system: false,
    created_at: nowIso(),
  })
  if (!staff && t.status === 'waiting') {
    t.status = 'in_progress'
    system(ctx, t, 'Житель ответил — заявка возвращена в работу')
  }
  t.updated_at = nowIso()
  return detail(ctx, t)
})
route('POST', '/tickets/{ticket_id}/rate', (ctx) => {
  if (ctx.user!.role !== 'resident') throw forbidden()
  const t = ticketOf(ctx, ctx.params.ticket_id)
  if (t.status !== 'resolved' && t.status !== 'closed') throw rule('Оценить можно только выполненную заявку')
  if (t.rating !== null) throw rule('Заявка уже оценена')
  t.rating = Number(ctx.body.rating)
  t.rating_comment = (ctx.body.comment as string) ?? null
  if (t.status === 'resolved') {
    t.status = 'closed'
    t.closed_at = nowIso()
    system(ctx, t, 'Житель подтвердил выполнение')
  }
  return detail(ctx, t)
})

// ---------- Пропуска ----------

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
const newCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')

function passOf(ctx: Ctx, id: number) {
  const p = ctx.db.passes.find((x) => x.id === id)
  if (!p || !canSee(ctx, p.apartment_id)) throw new ApiError(404, 'Пропуск не найден', 'not_found')
  return p
}
function invalidReason(p: PassRec): string | null {
  const now = new Date()
  if (p.status === 'pending') return 'Пропуск ещё не согласован УК'
  if (p.status === 'rejected') return 'Пропуск отклонён'
  if (p.status === 'cancelled') return 'Пропуск отменён'
  if (p.status === 'used') return 'Разовый пропуск уже использован'
  if (now < new Date(p.valid_from)) return `Пропуск действует с ${new Date(p.valid_from).toLocaleString('ru-RU')}`
  if (now >= new Date(p.valid_until)) return 'Срок действия пропуска истёк'
  return null
}

route('GET', '/passes', (ctx) => {
  const ids = ownApartments(ctx)
  const [status, kind, search] = [str(ctx, 'status'), str(ctx, 'kind'), str(ctx, 'search')]
  const now = new Date()
  const items = ctx.db.passes
    .filter(
      (p) =>
        (!ids || ids.includes(p.apartment_id)) &&
        (!status || p.status === status) &&
        (!kind || p.kind === kind) &&
        (!bool(ctx, 'active_now') ||
          (p.status === 'active' && new Date(p.valid_from) <= now && new Date(p.valid_until) > now)) &&
        (!search ||
          p.code === search.trim().toUpperCase() ||
          has(p.visitor_name, search) ||
          (p.vehicle_plate ?? '').includes(normalizePlate(search))),
    )
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1))
  return page(ctx, items.map((p) => ser.passRead(ctx.db, p)))
})
route('POST', '/passes', (ctx) => {
  const user = ctx.user!
  const b = ctx.body
  apartmentOf(ctx, Number(b.apartment_id))
  const from = b.valid_from ? new Date(String(b.valid_from)) : new Date()
  const until = b.valid_until ? new Date(String(b.valid_until)) : new Date(from.getTime() + 86400_000)
  if (until <= from) throw rule('Окончание действия должно быть позже начала')
  if (until <= new Date()) throw rule('Срок действия пропуска уже истёк')
  if (until.getTime() - from.getTime() > 366 * 86400_000) throw rule('Пропуск выдаётся не более чем на год')
  if (b.kind === 'vehicle' && !b.vehicle_plate) throw rule('Для въезда автомобиля укажите госномер')
  const oneTime = b.is_one_time !== false
  const autoApproved = isStaff(user) || (oneTime && until.getTime() - from.getTime() <= 86400_000)
  const pass: PassRec = {
    id: nextId(ctx.db),
    code: newCode(),
    apartment_id: Number(b.apartment_id),
    created_by_id: user.id,
    kind: (b.kind as PassRec['kind']) ?? 'guest',
    visitor_name: (b.visitor_name as string) || null,
    vehicle_plate: b.vehicle_plate ? normalizePlate(String(b.vehicle_plate)) : null,
    comment: (b.comment as string) || null,
    valid_from: from.toISOString(),
    valid_until: until.toISOString(),
    is_one_time: oneTime,
    status: autoApproved ? 'active' : 'pending',
    reviewed_at: isStaff(user) ? nowIso() : null,
    reject_reason: null,
    created_at: nowIso(),
    visits: [],
  }
  ctx.db.passes.push(pass)
  return ser.passDetail(ctx.db, pass)
})
route('GET', '/passes/check', (ctx) => {
  need(ctx, ...GUARDS)
  const code = str(ctx, 'code')
  const plate = str(ctx, 'plate')
  if (!code && !plate) throw rule('Укажите код пропуска или госномер')
  const since = Date.now() - 30 * 86400_000
  return ctx.db.passes
    .filter(
      (p) =>
        (!code || p.code === code.trim().toUpperCase()) &&
        (!plate || p.vehicle_plate === normalizePlate(plate)) &&
        new Date(p.valid_until).getTime() > since,
    )
    .map((p) => {
      const reason = invalidReason(p)
      return { ...ser.passDetail(ctx.db, p), valid_now: reason === null, reason }
    })
})
route('GET', '/passes/{pass_id}', (ctx) => ser.passDetail(ctx.db, passOf(ctx, ctx.params.pass_id)))
route('POST', '/passes/{pass_id}/approve', (ctx) => {
  need(ctx, ...GUARDS)
  const p = passOf(ctx, ctx.params.pass_id)
  if (p.status !== 'pending') throw rule('Согласовать можно только пропуск, ожидающий согласования')
  p.status = 'active'
  p.reviewed_at = nowIso()
  return ser.passDetail(ctx.db, p)
})
route('POST', '/passes/{pass_id}/reject', (ctx) => {
  need(ctx, ...GUARDS)
  const p = passOf(ctx, ctx.params.pass_id)
  if (p.status !== 'pending') throw rule('Отклонить можно только пропуск, ожидающий согласования')
  p.status = 'rejected'
  p.reject_reason = String(ctx.body.reason)
  p.reviewed_at = nowIso()
  return ser.passDetail(ctx.db, p)
})
route('POST', '/passes/{pass_id}/cancel', (ctx) => {
  const p = passOf(ctx, ctx.params.pass_id)
  if (p.status !== 'pending' && p.status !== 'active') throw rule('Пропуск уже недействителен')
  if (!isStaff(ctx.user!) && p.created_by_id !== ctx.user!.id) throw new ApiError(403, 'Отменить можно только свой пропуск', 'forbidden')
  p.status = 'cancelled'
  return ser.passDetail(ctx.db, p)
})
route('POST', '/passes/{pass_id}/visits', (ctx) => {
  need(ctx, ...GUARDS)
  const p = passOf(ctx, ctx.params.pass_id)
  const reason = invalidReason(p)
  if (reason) throw rule(reason)
  p.visits.push({ id: nextId(ctx.db), entered_at: nowIso(), checked_by_id: ctx.user!.id, note: (ctx.body.note as string) ?? null })
  if (p.is_one_time) p.status = 'used'
  return ser.passDetail(ctx.db, p)
})

// ---------- Объявления ----------

route('GET', '/announcements', (ctx) => {
  const ids = ownApartments(ctx)
  const buildings = ids && new Set(ctx.db.apartments.filter((a) => ids.includes(a.id)).map((a) => a.building_id))
  const buildingId = num(ctx, 'building_id')
  const now = nowIso()
  const items = ctx.db.announcements
    .filter(
      (a) =>
        (!buildings || (a.published_at <= now && (a.building_id === null || buildings.has(a.building_id)))) &&
        (!buildingId || a.building_id === null || a.building_id === buildingId),
    )
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || (a.published_at < b.published_at ? 1 : -1))
  return page(ctx, items.map((a) => ser.announcementRead(ctx.db, a)))
})
route('POST', '/announcements', (ctx) => {
  need(ctx, ...MANAGERS)
  const b = ctx.body
  const item = {
    id: nextId(ctx.db),
    title: String(b.title),
    body: String(b.body),
    building_id: (b.building_id as number) ?? null,
    is_pinned: Boolean(b.is_pinned),
    published_at: (b.published_at as string) ?? nowIso(),
    created_at: nowIso(),
  }
  ctx.db.announcements.push(item)
  return ser.announcementRead(ctx.db, item)
})
route('PATCH', '/announcements/{announcement_id}', (ctx) => {
  need(ctx, ...MANAGERS)
  const a = ctx.db.announcements.find((x) => x.id === ctx.params.announcement_id)
  if (!a) throw notFound('Объявление не найдено')
  for (const [key, value] of Object.entries(ctx.body)) if (value !== null && value !== undefined) Object.assign(a, { [key]: value })
  return ser.announcementRead(ctx.db, a)
})
route('DELETE', '/announcements/{announcement_id}', (ctx) => {
  need(ctx, ...MANAGERS)
  ctx.db.announcements = ctx.db.announcements.filter((a) => a.id !== ctx.params.announcement_id)
  return null
})

// ---------- Сводка ----------

route('GET', '/dashboard', (ctx) => {
  need(ctx, ...STAFF)
  const { db } = ctx
  const now = new Date()
  const current = periodOf(now)
  const [start] = periodBounds(current)
  const open = db.tickets.filter((t) => ['new', 'in_progress', 'waiting'].includes(t.status))
  const byCategory: Record<string, number> = {}
  for (const t of open) byCategory[t.category] = (byCategory[t.category] ?? 0) + 1
  const active = db.meters.filter((m) => m.is_active)
  const in30 = isoDate(new Date(now.getTime() + 30 * 86400_000))
  const debts = db.apartments.map((a) => balance(db, a.id).balance).filter((b) => b > 0)
  const history = Array.from({ length: 6 }, (_, i) => {
    const period = addMonths(current, i - 5)
    const [s, e] = periodBounds(period)
    return {
      period,
      charged: money(
        db.invoices.filter((x) => x.period === period && ['issued', 'partially_paid', 'paid'].includes(x.status)).reduce((sum, x) => sum + x.amount, 0),
      ),
      paid: money(db.payments.filter((p) => new Date(p.paid_at) >= s && new Date(p.paid_at) < e).reduce((sum, p) => sum + p.amount, 0)),
    }
  })
  return {
    buildings: db.buildings.length,
    apartments: db.apartments.length,
    residents: db.users.filter((u) => u.role === 'resident' && u.is_active).length,
    tickets: {
      open: open.length,
      new: open.filter((t) => t.status === 'new').length,
      overdue: open.filter(ser.isOverdue).length,
      emergency: open.filter((t) => t.priority === 'emergency').length,
      by_category: byCategory,
    },
    readings: {
      period: current,
      active_meters: active.length,
      meters_with_readings: active.filter((m) => db.readings.some((r) => r.meter_id === m.id && new Date(r.taken_at) >= start)).length,
      verification_due_30d: active.filter((m) => m.verification_due !== null && m.verification_due <= in30).length,
    },
    billing: { total_debt: money(debts.reduce((s, b) => s + b, 0)), debtors: debts.length, history },
    passes: {
      pending: db.passes.filter((p) => p.status === 'pending').length,
      active_now: db.passes.filter((p) => p.status === 'active' && new Date(p.valid_from) <= now && new Date(p.valid_until) > now).length,
    },
  }
})

// ---------- Интеграции (в демо внешние системы недоступны) ----------

route('GET', '/integrations/api-keys', (ctx) => {
  need(ctx, 'admin')
  return [...ctx.db.apiKeys].reverse()
})
route('POST', '/integrations/api-keys', (ctx) => {
  need(ctx, 'admin')
  const prefix = Math.random().toString(16).slice(2, 10)
  const key = { id: nextId(ctx.db), name: String(ctx.body.name), prefix, is_active: true, created_at: nowIso(), last_used_at: null }
  ctx.db.apiKeys.push(key)
  return { ...key, key: `ukapi_${prefix}_${crypto.randomUUID().replaceAll('-', '')}` }
})
route('POST', '/integrations/api-keys/{key_id}/revoke', (ctx) => {
  need(ctx, 'admin')
  const key = ctx.db.apiKeys.find((k) => k.id === ctx.params.key_id)
  if (!key) throw notFound('API-ключ не найден')
  key.is_active = false
  return key
})
route('GET', '/integrations/sources', (ctx) => {
  need(ctx, 'admin')
  return ctx.db.sources.map((s) => ({ ...s, kind: 'http_json' as const }))
})
route('POST', '/integrations/sources', (ctx) => {
  need(ctx, 'admin')
  const source = {
    id: nextId(ctx.db),
    name: String(ctx.body.name),
    url: String(ctx.body.url),
    has_token: Boolean(ctx.body.auth_token),
    is_active: ctx.body.is_active !== false,
    cursor: null,
    last_synced_at: null,
    last_status: null,
    last_error: null,
  }
  ctx.db.sources.push(source)
  return { ...source, kind: 'http_json' }
})
route('PATCH', '/integrations/sources/{source_id}', (ctx) => {
  need(ctx, 'admin')
  const s = ctx.db.sources.find((x) => x.id === ctx.params.source_id)
  if (!s) throw notFound('Источник данных не найден')
  if (typeof ctx.body.is_active === 'boolean') s.is_active = ctx.body.is_active
  if (ctx.body.name) s.name = String(ctx.body.name)
  return { ...s, kind: 'http_json' }
})
route('POST', '/integrations/sources/{source_id}/sync', (ctx) => {
  need(ctx, 'admin')
  const s = ctx.db.sources.find((x) => x.id === ctx.params.source_id)
  if (!s) throw notFound('Источник данных не найден')
  s.last_synced_at = nowIso()
  s.last_status = 'error'
  s.last_error = 'Демо-режим: запросы во внешние системы не выполняются'
  return { source_id: s.id, status: 'error', report: null, error: s.last_error }
})

// ---------- Точка входа ----------

const json = (status: number, body: unknown) =>
  new Response(body === null && status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Подменяет fetch для openapi-fetch: тот же контракт, что у настоящего API. */
export async function handle(request: Request): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, 120)) // имитация сети — видны состояния загрузки
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  for (const r of routes) {
    if (r.method !== method) continue
    const match = r.pattern.exec(url.pathname.replace(/^.*?(\/api\/v1\/)/, '/api/v1/'))
    if (!match) continue
    const db = getDb()
    const token = request.headers.get('Authorization')?.replace('Bearer demo.', '')
    const user = db.users.find((u) => String(u.id) === token && u.is_active) ?? null
    if (!r.public && !user) return json(401, { detail: 'Требуется авторизация', code: 'unauthorized' })
    const params = Object.fromEntries(r.keys.map((key, i) => [key, Number(match[i + 1])]))
    const text = method === 'GET' ? '' : await request.text()
    try {
      const result = r.handler({ db, user, params, query: url.searchParams, body: text ? JSON.parse(text) : {} })
      if (method !== 'GET') persist()
      if (result === null) return json(204, null)
      const created = method === 'POST' && !/\/(run|issue|cancel|approve|reject|status|rate|sync|revoke|login)$/.test(url.pathname)
      return json(created ? 201 : 200, result)
    } catch (error) {
      if (error instanceof ApiError) return json(error.status, { detail: error.detail, code: error.code })
      console.error(error)
      return json(500, { detail: 'Ошибка демо-сервера', code: 'internal' })
    }
  }
  return json(404, { detail: 'Not Found', code: 'not_found' })
}

