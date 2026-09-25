import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type FlagForgeOptions } from './client'
import { booleanFlag, FakeEventSource, memoryStorage, payload, silentLogger } from './testing/fakes'

const base: FlagForgeOptions = {
  baseUrl: 'https://flags.test/',
  sdkKey: 'sdk-production-abcdefghijkl',
  context: { key: 'user-1' },
  EventSource: FakeEventSource as unknown as FlagForgeOptions['EventSource'],
  storage: null,
  logger: silentLogger,
}

describe('FlagForgeClient', () => {
  beforeEach(() => FakeEventSource.reset())
  afterEach(() => vi.useRealTimers())

  describe('streaming', () => {
    it('connects to the stream with the SDK key', () => {
      createClient(base)
      expect(FakeEventSource.latest().url).toBe('https://flags.test/sdk/stream?sdkKey=sdk-production-abcdefghijkl')
    })

    it('serves defaults until the first payload, then real values', async () => {
      const client = createClient(base)
      expect(client.getStatus()).toBe('initializing')
      expect(client.variation('new-checkout', false)).toBe(false)

      FakeEventSource.latest().emit('put', payload(1, booleanFlag('new-checkout')))
      expect(await client.ready()).toBe('ready')
      expect(client.variation('new-checkout', false)).toBe(true)
    })

    it('notifies subscribers with the keys that changed', () => {
      const client = createClient(base)
      const source = FakeEventSource.latest()
      source.emit('put', payload(1, booleanFlag('a'), booleanFlag('b')))

      const listener = vi.fn()
      client.subscribe(listener)
      source.emit('put', payload(2, booleanFlag('a', { enabled: false }), booleanFlag('b')))
      expect(listener).toHaveBeenCalledWith({ keys: ['a'], status: 'ready' })
    })

    it('ignores payloads older than the current one', () => {
      const client = createClient(base)
      const source = FakeEventSource.latest()
      source.emit('put', payload(5, booleanFlag('a')))
      source.emit('put', payload(4, booleanFlag('a', { enabled: false })))
      expect(client.variation('a', false)).toBe(true)
    })

    it('ignores malformed payloads', () => {
      const client = createClient(base)
      FakeEventSource.latest().emit('put', 'not json')
      FakeEventSource.latest().emit('put', { nope: true })
      expect(client.getStatus()).toBe('initializing')
    })

    it('goes stale on connection errors but keeps serving the last flags', () => {
      const client = createClient(base)
      const source = FakeEventSource.latest()
      source.emit('put', payload(1, booleanFlag('a')))
      source.emit('error')
      expect(client.getStatus()).toBe('stale')
      expect(client.variation('a', false)).toBe(true)
      // The browser reconnects and the server sends a fresh payload.
      source.emit('put', payload(2, booleanFlag('a')))
      expect(client.getStatus()).toBe('ready')
    })

    it('reports an error when it has never received flags', async () => {
      const client = createClient(base)
      FakeEventSource.latest().emit('error')
      expect(await client.ready()).toBe('error')
    })

    it('stops streaming when the SDK key is revoked', () => {
      const client = createClient(base)
      const source = FakeEventSource.latest()
      source.emit('put', payload(1, booleanFlag('a')))
      source.emit('revoked', { reason: 'sdk-key-rotated' })
      expect(source.closed).toBe(true)
      expect(client.getStatus()).toBe('stale')
    })
  })

  describe('evaluation', () => {
    it('re-evaluates locally on identify, without a network call', () => {
      const flag = booleanFlag('beta', {
        fallthrough: { kind: 'variation', variationId: 'off' },
        rules: [{ id: 'r', clauses: [{ attribute: 'plan', operator: 'in', values: ['pro'] }], serve: { kind: 'variation', variationId: 'on' } }],
      })
      const fetch = vi.fn()
      const client = createClient({ ...base, fetch, bootstrap: payload(1, flag) })
      const listener = vi.fn()
      client.subscribe(listener)

      expect(client.variation('beta', false)).toBe(false)
      client.identify({ key: 'user-1', plan: 'pro' })
      expect(client.variation('beta', false)).toBe(true)
      expect(listener).toHaveBeenCalledWith({ keys: ['beta'], status: 'stale' })
      expect(fetch).not.toHaveBeenCalled()
    })

    it('does not notify when identify changes nothing', () => {
      const client = createClient({ ...base, bootstrap: payload(1, booleanFlag('a')) })
      const listener = vi.fn()
      client.subscribe(listener)
      client.identify({ key: 'user-2' })
      expect(listener).not.toHaveBeenCalled()
    })

    it('explains the result with variationDetail', () => {
      const client = createClient({ ...base, bootstrap: payload(1, booleanFlag('a')) })
      expect(client.variationDetail('a', false)).toEqual({ value: true, variationId: 'on', reason: { kind: 'FALLTHROUGH', inRollout: false } })
      expect(client.variationDetail('a', 'text').reason).toEqual({ kind: 'ERROR', errorKind: 'WRONG_TYPE' })
      expect(client.variationDetail('missing', 1).reason).toEqual({ kind: 'FLAG_NOT_FOUND' })
    })

    it('lists every flag value', () => {
      const client = createClient({ ...base, bootstrap: payload(1, booleanFlag('a'), booleanFlag('b', { enabled: false })) })
      expect(client.allFlags()).toEqual({ a: true, b: false })
    })

    it('returns the same object reference while the payload is unchanged', () => {
      const flag = booleanFlag('theme', { variations: [{ id: 'on', value: { accent: 'green' } }], offVariationId: 'on' })
      const client = createClient({ ...base, bootstrap: payload(1, flag) })
      expect(client.variation('theme', {})).toBe(client.variation('theme', {}))
    })
  })

  describe('bootstrap and cache', () => {
    it('starts from a bootstrap payload as stale until the server confirms', async () => {
      const client = createClient({ ...base, bootstrap: payload(3, booleanFlag('a')) })
      expect(await client.ready()).toBe('stale')
      expect(client.variation('a', false)).toBe(true)
    })

    it('caches live payloads and starts from the cache next time', () => {
      const storage = memoryStorage()
      createClient({ ...base, storage })
      FakeEventSource.latest().emit('put', payload(1, booleanFlag('a')))
      expect(storage.data.size).toBe(1)

      const next = createClient({ ...base, storage })
      expect(next.getStatus()).toBe('stale')
      expect(next.variation('a', false)).toBe(true)
    })

    it('survives a corrupted or throwing storage', () => {
      const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } }
      const client = createClient({ ...base, storage: broken })
      FakeEventSource.latest().emit('put', payload(1, booleanFlag('a')))
      expect(client.variation('a', false)).toBe(true)
    })
  })

  describe('polling', () => {
    const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

    it('fetches with the SDK key and polls on an interval', async () => {
      vi.useFakeTimers()
      const fetch = vi.fn().mockReturnValueOnce(ok(payload(1, booleanFlag('a')))).mockReturnValueOnce(ok(payload(2, booleanFlag('a', { enabled: false }))))
      const client = createClient({ ...base, streaming: false, fetch, pollIntervalMs: 10_000 })

      await vi.waitFor(() => expect(client.getStatus()).toBe('ready'))
      expect(fetch).toHaveBeenCalledWith('https://flags.test/sdk/flags', { headers: { Authorization: base.sdkKey } })
      expect(client.variation('a', false)).toBe(true)

      await vi.advanceTimersByTimeAsync(10_000)
      expect(client.variation('a', true)).toBe(false)
      client.close()
    })

    it('reports an error on HTTP failures', async () => {
      const fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }))
      const client = createClient({ ...base, streaming: false, fetch, pollIntervalMs: 0 })
      expect(await client.ready()).toBe('error')
    })
  })

  it('stops everything on close', () => {
    const client = createClient(base)
    const listener = vi.fn()
    client.subscribe(listener)
    client.close()
    client.identify({ key: 'someone-else' })
    FakeEventSource.latest().emit('put', payload(1, booleanFlag('a')))
    expect(FakeEventSource.latest().closed).toBe(true)
    expect(client.getStatus()).toBe('closed')
    // Subscribers hear about the close itself, and nothing after it.
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith({ keys: [], status: 'closed' })
  })

  it('resolves ready after the timeout even without flags', async () => {
    vi.useFakeTimers()
    const client = createClient(base)
    const ready = client.ready(1000)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await ready).toBe('initializing')
  })
})
