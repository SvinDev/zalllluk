/**
 * Хранилище демо-режима: «таблицы» бэкенда в памяти браузера.
 * Состояние у каждого посетителя своё и переживает перезагрузку (localStorage).
 */
import type {
  CalculationBasis,
  InvoiceStatus,
  MeterKind,
  PassKind,
  PaymentMethod,
  ReadingSource,
  TariffMethod,
  TicketCategory,
  TicketPriority,
  TicketStatus,
  UserRole,
} from '@/api/types'

import { seed } from './seed'

export type UserRec = {
  id: number
  email: string
  full_name: string
  phone: string | null
  role: UserRole
  password: string
  is_active: boolean
  created_at: string
}
export type BuildingRec = {
  id: number
  address: string
  floors: number | null
  entrances: number | null
  year_built: number | null
  notes: string | null
}
export type ApartmentRec = {
  id: number
  building_id: number
  number: string
  account_number: string
  area: number
  residents_count: number
  owner_name: string | null
  resident_ids: number[]
}
export type MeterRec = {
  id: number
  apartment_id: number
  kind: MeterKind
  serial_number: string
  external_id: string | null
  installed_at: string | null
  verification_due: string | null
  initial_value: number
  is_active: boolean
}
export type ReadingRec = {
  id: number
  meter_id: number
  value: number
  taken_at: string
  source: ReadingSource
  submitted_by_id: number | null
  created_at: string
}
export type TariffRec = {
  id: number
  name: string
  method: TariffMethod
  meter_kind: MeterKind | null
  rate: number
  normative: number | null
  building_id: number | null
  valid_from: string
  valid_to: string | null
}
export type InvoiceLineRec = {
  id: number
  tariff_id: number | null
  meter_id: number | null
  service_name: string
  unit: string
  quantity: number
  rate: number
  amount: number
  basis: CalculationBasis
  reading_from: number | null
  reading_to: number | null
  details: string | null
}
export type InvoiceRec = {
  id: number
  number: string
  apartment_id: number
  period: string
  status: InvoiceStatus
  amount: number
  opening_balance: number
  paid_amount: number
  due_date: string | null
  issued_at: string | null
  created_at: string
  lines: InvoiceLineRec[]
}
export type PaymentRec = {
  id: number
  apartment_id: number
  amount: number
  paid_at: string
  method: PaymentMethod
  reference: string | null
  comment: string | null
  created_at: string
}
export type CommentRec = {
  id: number
  author_id: number | null
  body: string
  is_internal: boolean
  is_system: boolean
  created_at: string
}
export type TicketRec = {
  id: number
  building_id: number
  apartment_id: number | null
  author_id: number | null
  assignee_id: number | null
  category: TicketCategory
  priority: TicketPriority
  status: TicketStatus
  subject: string
  description: string
  due_at: string
  resolved_at: string | null
  closed_at: string | null
  rating: number | null
  rating_comment: string | null
  created_at: string
  updated_at: string
  comments: CommentRec[]
}
export type PassStatus = 'pending' | 'active' | 'rejected' | 'used' | 'cancelled'
export type VisitRec = { id: number; entered_at: string; checked_by_id: number | null; note: string | null }
export type PassRec = {
  id: number
  code: string
  apartment_id: number
  created_by_id: number | null
  kind: PassKind
  visitor_name: string | null
  vehicle_plate: string | null
  comment: string | null
  valid_from: string
  valid_until: string
  is_one_time: boolean
  status: PassStatus
  reviewed_at: string | null
  reject_reason: string | null
  created_at: string
  visits: VisitRec[]
}
export type AnnouncementRec = {
  id: number
  title: string
  body: string
  building_id: number | null
  is_pinned: boolean
  published_at: string
  created_at: string
}
export type ApiKeyRec = {
  id: number
  name: string
  prefix: string
  is_active: boolean
  created_at: string
  last_used_at: string | null
}
export type SourceRec = {
  id: number
  name: string
  url: string
  has_token: boolean
  is_active: boolean
  cursor: string | null
  last_synced_at: string | null
  last_status: string | null
  last_error: string | null
}

export type DB = {
  version: number
  seq: number
  users: UserRec[]
  buildings: BuildingRec[]
  apartments: ApartmentRec[]
  meters: MeterRec[]
  readings: ReadingRec[]
  tariffs: TariffRec[]
  invoices: InvoiceRec[]
  payments: PaymentRec[]
  tickets: TicketRec[]
  passes: PassRec[]
  announcements: AnnouncementRec[]
  apiKeys: ApiKeyRec[]
  sources: SourceRec[]
}

export const DB_VERSION = 1
const KEY = 'uk.demo.db'

let current: DB | null = null

export function db(): DB {
  if (current) return current
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as DB
      if (parsed.version === DB_VERSION) current = parsed
    }
  } catch {
    /* хранилище недоступно или повреждено — начнём с чистых данных */
  }
  current ??= seed()
  return current
}

export function persist(): void {
  if (!current) return
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* без хранилища демо работает до перезагрузки страницы */
  }
}

export function resetDemo(): void {
  current = null
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
