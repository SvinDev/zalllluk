import { useContext } from 'react'

import { AuthContext, type AuthState } from './context'

export function useAuth(): AuthState {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>')
  return context
}

export const STAFF = ['admin', 'manager', 'accountant', 'security'] as const
export const MANAGERS = ['admin', 'manager'] as const
export const ACCOUNTANTS = ['admin', 'accountant'] as const
export const GUARDS = ['admin', 'manager', 'security'] as const
