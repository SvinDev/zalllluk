import { Result, Spin } from 'antd'
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import type { UserRole } from '@/api/types'

import { useAuth } from './useAuth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return <Spin size="large" fullscreen />
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}

export function RequireRole({
  roles,
  children,
}: {
  roles: readonly UserRole[]
  children: ReactNode
}) {
  const { hasRole } = useAuth()
  if (!hasRole(...roles)) {
    return <Result status="403" title="Нет доступа" subTitle="Этот раздел недоступен для вашей роли" />
  }
  return children
}
