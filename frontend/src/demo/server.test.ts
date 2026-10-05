import { beforeEach, describe, expect, it } from 'vitest'

import { handle } from './server'
import { resetDemo } from './store'

async function call(method: string, path: string, token?: string, body?: unknown) {
  const response = await handle(
    new Request(`http://demo/api/v1${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  const text = await response.text()
  return { status: response.status, data: text ? JSON.parse(text) : null }
}

async function login(email: string) {
  const { data } = await call('POST', '/auth/login', undefined, { email, password: 'demo12345' })
  return data.access_token as string
}

describe('demo API emulator', () => {
  beforeEach(() => resetDemo())

  it('requires auth and rejects wrong passwords', async () => {
    expect((await call('GET', '/auth/me')).status).toBe(401)
    expect((await call('POST', '/auth/login', undefined, { email: 'admin@demo.ru', password: 'x' })).status).toBe(401)
  })

  it('scopes residents to their own apartment', async () => {
    const token = await login('resident@demo.ru')
    const me = await call('GET', '/auth/me', token)
    expect(me.data.apartments).toHaveLength(1)
    const invoices = await call('GET', '/invoices', token)
    expect(invoices.data.total).toBe(5)
    expect(invoices.data.items.every((i: { status: string }) => i.status !== 'draft')).toBe(true)
    const guard = await login('guard@demo.ru')
    expect((await call('GET', '/invoices', guard)).status).toBe(403)
  })

  it('validates readings like the backend', async () => {
    const token = await login('resident@demo.ru')
    const meter = (await call('GET', '/meters', token)).data.items[0]
    const low = await call('POST', `/meters/${meter.id}/readings`, token, { value: '0' })
    expect(low.status).toBe(422)
    const ok = await call('POST', `/meters/${meter.id}/readings`, token, { value: '99999' })
    expect(ok.status).toBe(201)
    expect(ok.data.source).toBe('resident')
  })

  it('runs billing, issues receipts with a payment QR and lets the guard check passes', async () => {
    const buh = await login('buh@demo.ru')
    const period = new Date().toISOString().slice(0, 7)
    const run = await call('POST', '/billing/run', buh, { period })
    expect(run.data.regenerated + run.data.created).toBe(20)
    expect((await call('POST', '/billing/issue', buh, { period })).data.issued).toBe(20)
    const invoice = (await call('GET', `/invoices?period=${period}`, buh)).data.items[0]
    const detail = await call('GET', `/invoices/${invoice.id}`, buh)
    expect(detail.data.lines.length).toBeGreaterThan(3)
    if (detail.data.status !== 'paid') expect(detail.data.payment_qr).toMatch(/^ST00012\|Name=/)

    const guard = await login('guard@demo.ru')
    const [pass] = (await call('GET', '/passes/check?code=gst7k2', guard)).data
    expect(pass.valid_now).toBe(true)
    await call('POST', `/passes/${pass.id}/visits`, guard, {})
    const [used] = (await call('GET', '/passes/check?code=GST7K2', guard)).data
    expect(used.reason).toBe('Разовый пропуск уже использован')
  })
})
