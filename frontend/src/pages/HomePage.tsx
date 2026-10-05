import { lazy } from 'react'
import { Navigate } from 'react-router'

import { useAuth } from '@/auth/useAuth'

const DashboardPage = lazy(() => import('./DashboardPage'))
const ResidentHomePage = lazy(() => import('./ResidentHomePage'))

/** Главная зависит от роли: сводка для офиса УК, кабинет для жителя, пост для охраны. */
export function HomePage() {
  const { user } = useAuth()
  if (user?.role === 'resident') return <ResidentHomePage />
  if (user?.role === 'security') return <Navigate to="/guard" replace />
  return <DashboardPage />
}
