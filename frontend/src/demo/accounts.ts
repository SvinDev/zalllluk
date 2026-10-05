import type { UserRole } from '@/api/types'

export const IS_DEMO = import.meta.env.VITE_DEMO === 'true'
export const DEMO_PASSWORD = 'demo12345'

export const DEMO_ACCOUNTS: { email: string; role: UserRole; hint: string }[] = [
  { email: 'resident@demo.ru', role: 'resident', hint: 'квитанции, счётчики, заявки' },
  { email: 'manager@demo.ru', role: 'manager', hint: 'жилфонд, заявки, пропуска' },
  { email: 'buh@demo.ru', role: 'accountant', hint: 'тарифы, начисления, оплаты' },
  { email: 'guard@demo.ru', role: 'security', hint: 'пост охраны, код GST7K2' },
  { email: 'admin@demo.ru', role: 'admin', hint: 'всё, включая интеграции' },
]
