import { createContext } from 'react'

import type { Profile, UserRole } from '@/api/types'

export type AuthState = {
  user: Profile | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  hasRole: (...roles: UserRole[]) => boolean
}

export const AuthContext = createContext<AuthState | null>(null)
