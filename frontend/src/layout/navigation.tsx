import {
  ApiOutlined,
  AppstoreOutlined,
  BankOutlined,
  CalculatorOutlined,
  CarOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileTextOutlined,
  HomeOutlined,
  NotificationOutlined,
  SafetyOutlined,
  TableOutlined,
  TeamOutlined,
  ToolOutlined,
  WarningOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { ReactNode } from 'react'

import type { UserRole } from '@/api/types'

export type NavItem = { path: string; label: string; icon: ReactNode; roles: readonly UserRole[] }
export type NavGroup = { label: string; items: NavItem[] }

const ALL: readonly UserRole[] = ['admin', 'manager', 'accountant', 'security', 'resident']
const OFFICE: readonly UserRole[] = ['admin', 'manager', 'accountant']

export const navigation: NavGroup[] = [
  {
    label: '',
    items: [
      { path: '/', label: 'Сводка', icon: <DashboardOutlined />, roles: OFFICE },
      { path: '/', label: 'Главная', icon: <HomeOutlined />, roles: ['resident'] },
      { path: '/guard', label: 'Пост охраны', icon: <SafetyOutlined />, roles: ['admin', 'manager', 'security'] },
    ],
  },
  {
    label: 'Жилфонд',
    items: [
      { path: '/buildings', label: 'Дома', icon: <BankOutlined />, roles: OFFICE },
      { path: '/apartments', label: 'Помещения', icon: <AppstoreOutlined />, roles: OFFICE },
      { path: '/users', label: 'Пользователи', icon: <TeamOutlined />, roles: ['admin', 'manager'] },
    ],
  },
  {
    label: 'Учёт',
    items: [
      { path: '/meters', label: 'Счётчики', icon: <ThunderboltOutlined />, roles: [...OFFICE, 'resident'] },
      { path: '/readings', label: 'Журнал показаний', icon: <TableOutlined />, roles: OFFICE },
    ],
  },
  {
    label: 'Финансы',
    items: [
      { path: '/billing', label: 'Начисления', icon: <CalculatorOutlined />, roles: ['admin', 'accountant'] },
      { path: '/tariffs', label: 'Тарифы', icon: <FileTextOutlined />, roles: OFFICE },
      { path: '/invoices', label: 'Квитанции', icon: <FileTextOutlined />, roles: [...OFFICE, 'resident'] },
      { path: '/payments', label: 'Оплаты', icon: <DollarOutlined />, roles: [...OFFICE, 'resident'] },
      { path: '/debtors', label: 'Должники', icon: <WarningOutlined />, roles: OFFICE },
    ],
  },
  {
    label: 'Сервис',
    items: [
      { path: '/tickets', label: 'Заявки', icon: <ToolOutlined />, roles: [...OFFICE, 'resident'] },
      { path: '/passes', label: 'Пропуска', icon: <CarOutlined />, roles: ALL },
      { path: '/announcements', label: 'Объявления', icon: <NotificationOutlined />, roles: ALL },
    ],
  },
  {
    label: 'Настройки',
    items: [{ path: '/integrations', label: 'Интеграции', icon: <ApiOutlined />, roles: ['admin'] }],
  },
]
