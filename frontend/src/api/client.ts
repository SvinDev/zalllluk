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

export const fetchClient = createFetchClient<paths>({ baseUrl: '' })
fetchClient.use(auth)

export const api = createClient(fetchClient)
