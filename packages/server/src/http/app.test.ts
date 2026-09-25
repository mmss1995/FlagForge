import http from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer } from '../createServer'
import { MemoryStore } from '../store/memoryStore'
import { ADMIN_TOKEN, testConfig } from '../test/fixtures'

type Server = Awaited<ReturnType<typeof createServer>>

const auth = { Authorization: `Bearer ${ADMIN_TOKEN}`, 'X-FlagForge-Actor': 'ada' }
const sdkAuth = { Authorization: 'sdk-production-test' }

describe('HTTP API', () => {
  let server: Server

  beforeEach(async () => {
    server = await createServer(testConfig, new MemoryStore())
  })

  afterEach(async () => {
    await server.close()
  })

  const api = () => request(server.app)

  it('reports health', async () => {
    await api().get('/health').expect(200, { status: 'ok', store: 'ok' })
  })

  describe('admin API', () => {
    it('rejects requests without the admin token', async () => {
      const res = await api().get('/api/flags').expect(401)
      expect(res.body.error.code).toBe('unauthorized')
      await api().get('/api/flags').set('Authorization', 'Bearer wrong').expect(401)
    })

    it('creates, lists and reads flags', async () => {
      await api().post('/api/flags').set(auth).send({ key: 'new-checkout', name: 'New checkout' }).expect(201)
      const list = await api().get('/api/flags').set(auth).expect(200)
      expect(list.body.map((f: { key: string }) => f.key)).toEqual(['new-checkout'])
      await api().get('/api/flags/new-checkout').set(auth).expect(200)
      await api().get('/api/flags/missing').set(auth).expect(404)
    })

    it('validates input and explains what is wrong', async () => {
      const res = await api().post('/api/flags').set(auth).send({ key: 'Not Valid', name: '' }).expect(400)
      expect(res.body.error.code).toBe('invalid_request')
      expect(res.body.error.details.map((i: { path: string[] }) => i.path[0])).toEqual(['key', 'name'])
    })

    it('rejects malformed JSON', async () => {
      const res = await api().post('/api/flags').set(auth).set('Content-Type', 'application/json').send('{nope').expect(400)
      expect(res.body.error.code).toBe('invalid_json')
    })

    it('updates targeting and records the actor in the audit log', async () => {
      await api().post('/api/flags').set(auth).send({ key: 'f', name: 'F' })
      await api().patch('/api/flags/f/targeting/production').set(auth).send({ enabled: true }).expect(200)
      const audit = await api().get('/api/audit?flagKey=f&limit=1').set(auth).expect(200)
      expect(audit.body[0]).toMatchObject({ actor: 'ada', changes: ['production: turned ON'] })
    })

    it('returns 409 on a stale expectedUpdatedAt', async () => {
      const created = await api().post('/api/flags').set(auth).send({ key: 'f', name: 'F' })
      await api().patch('/api/flags/f').set(auth).send({ name: 'G' }).expect(200)
      await api().patch('/api/flags/f').set(auth).send({ name: 'H', expectedUpdatedAt: created.body.updatedAt }).expect(409)
    })

    it('evaluates a flag for a test context', async () => {
      await api().post('/api/flags').set(auth).send({ key: 'f', name: 'F' })
      const res = await api().post('/api/flags/f/evaluate').set(auth).send({ environment: 'production', context: { key: 'u' } }).expect(200)
      expect(res.body).toEqual({ value: false, variationId: 'off', reason: { kind: 'OFF' } })
    })

    it('lists environments with their SDK keys and live connection counts', async () => {
      const res = await api().get('/api/environments').set(auth).expect(200)
      expect(res.body).toMatchObject([
        { key: 'development', sdkKey: 'sdk-development-test', connections: 0 },
        { key: 'production', sdkKey: 'sdk-production-test', connections: 0 },
      ])
    })
  })

  describe('SDK API', () => {
    beforeEach(async () => {
      await api().post('/api/flags').set(auth).send({ key: 'f', name: 'F' })
      await api().patch('/api/flags/f/targeting/production').set(auth).send({ enabled: true })
    })

    it('rejects unknown SDK keys', async () => {
      await api().get('/sdk/flags').set('Authorization', 'sdk-nope').expect(401)
    })

    it('serves the environment payload without admin-only fields', async () => {
      const res = await api().get('/sdk/flags').set(sdkAuth).expect(200)
      expect(res.body.environment).toBe('production')
      expect(res.body.flags.f).toMatchObject({ enabled: true, salt: expect.any(String) })
      expect(res.body.flags.f.name).toBeUndefined()
    })

    it('accepts the key as a Bearer token too', async () => {
      await api().get('/sdk/flags').set('Authorization', 'Bearer sdk-production-test').expect(200)
    })

    it('evaluates server-side', async () => {
      const res = await api().post('/sdk/evaluate').set(sdkAuth).send({ context: { key: 'u' } }).expect(200)
      expect(res.body.flags.f).toMatchObject({ value: true, reason: { kind: 'FALLTHROUGH' } })
    })

    it('answers CORS preflights for browser SDKs', async () => {
      const res = await api().options('/sdk/flags').set('Origin', 'https://shop.example').expect(204)
      expect(res.headers['access-control-allow-origin']).toBe('*')
      expect(res.headers['access-control-allow-headers']).toContain('Authorization')
    })

    it('does not expose CORS on the admin API', async () => {
      const res = await api().get('/api/flags').set(auth).set('Origin', 'https://evil.example')
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })
  })

  describe('SDK stream', () => {
    let listener: http.Server
    let baseUrl: string

    beforeEach(async () => {
      await api().post('/api/flags').set(auth).send({ key: 'f', name: 'F' })
      listener = http.createServer(server.app)
      await new Promise<void>((resolve) => listener.listen(0, resolve))
      baseUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
    })

    afterEach(async () => {
      listener.closeAllConnections()
      await new Promise((resolve) => listener.close(resolve))
    })

    it('sends the payload on connect and again after every change', async () => {
      const stream = await openStream(`${baseUrl}/sdk/stream?sdkKey=sdk-production-test`)
      const first = await stream.next('put')
      expect(JSON.parse(first).flags.f.enabled).toBe(false)

      await api().patch('/api/flags/f/targeting/production').set(auth).send({ enabled: true })
      const second = await stream.next('put')
      expect(JSON.parse(second).flags.f.enabled).toBe(true)
      expect(JSON.parse(second).version).toBeGreaterThan(JSON.parse(first).version)
      stream.close()
    })

    it('closes streams opened with a key that has been rotated', async () => {
      const stream = await openStream(`${baseUrl}/sdk/stream?sdkKey=sdk-production-test`)
      await stream.next('put')
      await api().post('/api/environments/production/rotate-sdk-key').set(auth).expect(200)
      expect(JSON.parse(await stream.next('revoked'))).toEqual({ reason: 'sdk-key-rotated' })
      await stream.ended
    })

    it('counts connections per environment', async () => {
      const stream = await openStream(`${baseUrl}/sdk/stream?sdkKey=sdk-production-test`)
      await stream.next('put')
      const res = await api().get('/api/environments').set(auth)
      expect(res.body.find((e: { key: string }) => e.key === 'production').connections).toBe(1)
      stream.close()
    })
  })
})

/** Minimal SSE reader over a raw HTTP response, enough to assert on events in order. */
async function openStream(url: string) {
  const controller = new AbortController()
  const res = await fetch(url, { signal: controller.signal })
  expect(res.headers.get('content-type')).toContain('text/event-stream')
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let done = false
  const ended = (async () => {
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined }))
      if (chunk.done) break
      buffer += chunk.value
    }
    done = true
  })()

  return {
    ended,
    async next(event: string, timeoutMs = 2000): Promise<string> {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const match = buffer.match(new RegExp(`event: ${event}\\n(?:id: \\d+\\n)?data: (.*)\\n\\n`))
        if (match) {
          buffer = buffer.slice(match.index! + match[0].length)
          return match[1]!
        }
        if (done || Date.now() > deadline) throw new Error(`No "${event}" event received`)
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    },
    close: () => controller.abort(),
  }
}
