import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { api, fetchClient } from '@/api/client'
import { errorMessage } from '@/api/errors'

import { AuthContext, type AuthState } from './context'
import { LOGOUT_EVENT, tokenStorage } from './token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState(() => tokenStorage.get())

  const me = api.useQuery('get', '/api/v1/auth/me', {}, { enabled: !!token, retry: false })

  const logout = useCallback(() => {
    tokenStorage.clear()
    setToken(null)
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    window.addEventListener(LOGOUT_EVENT, logout)
    return () => window.removeEventListener(LOGOUT_EVENT, logout)
  }, [logout])

  const login = useCallback(
    async (email: string, password: string) => {
      const { data, error } = await fetchClient.POST('/api/v1/auth/login', {
        body: { email, password },
      })
      if (error || !data) throw new Error(errorMessage(error, 'Не удалось войти'))
      tokenStorage.set(data.access_token)
      queryClient.clear()
      setToken(data.access_token)
    },
    [queryClient],
  )

  const user = token ? (me.data ?? null) : null
  const value = useMemo<AuthState>(
    () => ({
      user,
      loading: !!token && me.isPending,
      login,
      logout,
      hasRole: (...roles) => !!user && roles.includes(user.role),
    }),
    [user, token, me.isPending, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
