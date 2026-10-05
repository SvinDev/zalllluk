// Токен в localStorage: SPA без серверного рендеринга, cookie-сессии не используем.
// Обращения обёрнуты в try/catch — в приватном режиме хранилище может быть недоступно.
const KEY = 'uk.token'

export const tokenStorage = {
  get(): string | null {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  },
  set(token: string): void {
    try {
      localStorage.setItem(KEY, token)
    } catch {
      /* ignore */
    }
  },
  clear(): void {
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
  },
}

export const LOGOUT_EVENT = 'uk:logout'
