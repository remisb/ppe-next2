import { describe, expect, it, vi } from 'vitest'

import { ApiError, NetworkError } from './errors.ts'
import { createClient, historyQueryString } from './client.ts'

function fakeFetch(status: number, body: string) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(status === 204 ? null : body, { status }))
}

describe('createClient', () => {
  it('sends the bearer token and JSON body', async () => {
    const f = fakeFetch(200, '{"lines":[],"orderable":false}')
    const client = createClient({ getToken: () => 'tok', fetch: f as unknown as typeof fetch })
    await client.orders.resolve({ employee_id: 'e1', lines: [] })
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('/api/v1/orders/resolve')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok')
    expect(init?.body).toBe('{"employee_id":"e1","lines":[]}')
  })

  it('posts Mark as Ordered to /orders', async () => {
    const f = fakeFetch(201, '{"id":"o1","record_number":"WE-000001"}')
    const client = createClient({ getToken: () => 't', fetch: f as unknown as typeof fetch })
    const o = await client.orders.markAsOrdered({ employee_id: 'e', lines: [{ catalogue_item_id: 'i', quantity: 2, size: null }] })
    expect(o.record_number).toBe('WE-000001')
    expect(f.mock.calls[0]![0]).toBe('/api/v1/orders')
    expect(f.mock.calls[0]![1]?.method).toBe('POST')
  })

  it('sends confirmation tokens in the body, never the path', async () => {
    const f = fakeFetch(200, '{}')
    const client = createClient({ getToken: () => null, fetch: f as unknown as typeof fetch })
    await client.confirmations.confirm('secret-token')
    expect(f.mock.calls[0]![0]).toBe('/api/v1/confirmations/confirm')
    expect(f.mock.calls[0]![1]?.body).toBe('{"token":"secret-token","confirmed":true}')
  })

  it('changes the own password with the current one', async () => {
    const f = fakeFetch(204, '')
    const client = createClient({ getToken: () => 't', fetch: f as unknown as typeof fetch })
    await expect(client.changeOwnPassword('old-pass-1', 'new-pass-1')).resolves.toBeUndefined()
    expect(f.mock.calls[0]![0]).toBe('/api/v1/users/me/password')
    expect(f.mock.calls[0]![1]?.method).toBe('PUT')
    expect(f.mock.calls[0]![1]?.body).toBe('{"current_password":"old-pass-1","new_password":"new-pass-1"}')
  })

  it('updates a user with a full replace and resets a password by id', async () => {
    const f = fakeFetch(200, '{"id":"u1"}')
    const client = createClient({ getToken: () => 't', fetch: f as unknown as typeof fetch })
    await client.users.update('u1', { email: 'a@b.c', name: 'A', roles: ['manager'], is_active: false })
    expect(f.mock.calls[0]![0]).toBe('/api/v1/users/u1')
    expect(f.mock.calls[0]![1]?.method).toBe('PUT')
    expect(f.mock.calls[0]![1]?.body).toBe('{"email":"a@b.c","name":"A","roles":["manager"],"is_active":false}')
    await client.users.setPassword('u1', 'new-pass-1')
    expect(f.mock.calls[1]![0]).toBe('/api/v1/users/u1/password')
    expect(f.mock.calls[1]![1]?.body).toBe('{"password":"new-pass-1"}')
  })

  it('reads the dashboard', async () => {
    const f = fakeFetch(200, '{"months":[]}')
    const client = createClient({ getToken: () => 't', fetch: f as unknown as typeof fetch })
    await client.dashboard()
    expect(f.mock.calls[0]![0]).toBe('/api/v1/dashboard')
    expect(f.mock.calls[0]![1]?.method).toBe('GET')
    await client.managerDashboard()
    expect(f.mock.calls[1]![0]).toBe('/api/v1/dashboard/manager')
    await client.employeeDashboard()
    expect(f.mock.calls[2]![0]).toBe('/api/v1/dashboard/employee')
  })

  it('encodes path segments', async () => {
    const f = fakeFetch(200, '[]')
    const client = createClient({ getToken: () => null, fetch: f as unknown as typeof fetch })
    await client.employees.search('a/b c')
    expect(f.mock.calls[0]![0]).toBe('/api/v1/employees/by-name/a%2Fb%20c')
  })

  it('surfaces the API error message and calls onUnauthenticated on 401', async () => {
    const onUnauth = vi.fn()
    const client = createClient({
      getToken: () => 'x',
      onUnauthenticated: onUnauth,
      fetch: fakeFetch(401, 'unauthorized: invalid token') as unknown as typeof fetch,
    })
    const err = await client.me().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).isUnauthenticated).toBe(true)
    expect((err as ApiError).message).toBe('unauthorized: invalid token')
    expect(onUnauth).toHaveBeenCalledOnce()
  })

  it('reads the JSON error field', async () => {
    const client = createClient({ getToken: () => null, fetch: fakeFetch(409, '{"error":"catalogue item name already in use"}') as unknown as typeof fetch })
    const err = (await client.catalogue.create({} as never).catch((e: unknown) => e)) as ApiError
    expect(err.isConflict).toBe(true)
    expect(err.message).toBe('catalogue item name already in use')
  })

  it('returns undefined for 204', async () => {
    const client = createClient({ getToken: () => null, fetch: fakeFetch(204, '') as unknown as typeof fetch })
    await expect(client.employees.remove('x')).resolves.toBeUndefined()
  })

  it('wraps network failures', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const client = createClient({ getToken: () => null, fetch: f as unknown as typeof fetch })
    await expect(client.me()).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('historyQueryString', () => {
  it('leaves out empty filters', () => {
    expect(historyQueryString({})).toBe('')
    expect(historyQueryString({ status: 'GIVEN', from: '', page: 2 })).toBe('?status=GIVEN&page=2')
    expect(historyQueryString({ sort: 'total', dir: 'desc' })).toBe('?sort=total&dir=desc')
  })
})
