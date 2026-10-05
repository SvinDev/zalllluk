import createFetchClient, { type Middleware } from 'openapi-fetch'
import createClient from 'openapi-react-query'

import { LOGOUT_EVENT, tokenStorage } from '@/auth/token'

import type { paths } from './schema'

const auth: Middleware = {
  onRequest({ request }) {
    const token = tokenStorage.get()
    if (token) request.headers.set('Authorization', `Bearer ${token}`)
    return request
  },
  onResponse({ response }) {
    // Истёкший или отозванный токен — разлогиниваем, но не на самом логине.
    if (response.status === 401 && tokenStorage.get()) {
      tokenStorage.clear()
      window.dispatchEvent(new Event(LOGOUT_EVENT))
    }
    return response
  },
}

// Демо-сборка (GitHub Pages) работает без бэкенда: запросы обслуживает эмулятор API
// в браузере. Флаг подставляется при сборке, в обычный бандл эмулятор не попадает.
const demoFetch = async (request: Request) => (await import('@/demo/server')).handle(request)

export const fetchClient = createFetchClient<paths>({
  baseUrl: '',
  fetch: import.meta.env.VITE_DEMO === 'true' ? demoFetch : undefined,
})
fetchClient.use(auth)

export const api = createClient(fetchClient)
