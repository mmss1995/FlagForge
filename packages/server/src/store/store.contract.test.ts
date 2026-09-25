import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeFlag, nextEvent } from '../test/fixtures'
import { MemoryStore } from './memoryStore'
import { RedisStore } from './redisStore'
import type { Store, StoreEvent } from './types'

/**
 * Every store implementation must behave the same. The Redis variant runs when TEST_REDIS_URL is set
 * (CI starts a Redis service; locally: `docker compose up -d redis`).
 */
const redisUrl = process.env.TEST_REDIS_URL

const implementations: [string, () => Store, boolean][] = [
  ['MemoryStore', () => new MemoryStore(), true],
  ['RedisStore', () => new RedisStore(redisUrl!, `fftest:${randomUUID()}:`), Boolean(redisUrl)],
]

describe.each(implementations)('%s', (_name, create, enabled) => {
  let store: Store

  beforeEach(() => {
    if (enabled) store = create()
  })

  afterEach(async () => {
    if (!enabled) return
    if (store instanceof RedisStore) await store.clear()
    await store.close()
  })

  it.runIf(enabled)('creates an environment only once', async () => {
    const env = { key: 'production', name: 'Production', sdkKey: 'sdk-1', createdAt: '2026-09-25T10:00:00.000Z' }
    expect(await store.createEnvironment(env)).toBe(true)
    expect(await store.createEnvironment({ ...env, sdkKey: 'sdk-2' })).toBe(false)
    expect((await store.getEnvironment('production'))?.sdkKey).toBe('sdk-1')
    expect(await store.listEnvironments()).toHaveLength(1)
  })

  it.runIf(enabled)('refuses to create a flag that already exists', async () => {
    expect(await store.saveFlag(makeFlag(), null)).toBe(1)
    expect(await store.saveFlag(makeFlag(), null)).toBeNull()
    expect(await store.getRevision()).toBe(1)
  })

  it.runIf(enabled)('updates a flag only when updatedAt still matches', async () => {
    const flag = makeFlag()
    await store.saveFlag(flag, null)
    const updated = { ...flag, name: 'Renamed', updatedAt: '2026-09-25T11:00:00.000Z' }

    expect(await store.saveFlag(updated, '2026-01-01T00:00:00.000Z')).toBeNull()
    expect(await store.saveFlag(updated, flag.updatedAt)).toBe(2)
    expect((await store.getFlag(flag.key))?.name).toBe('Renamed')
    // The old token no longer works: a concurrent writer holding it is rejected.
    expect(await store.saveFlag({ ...flag, name: 'Stale' }, flag.updatedAt)).toBeNull()
  })

  it.runIf(enabled)('refuses to update a flag that does not exist', async () => {
    expect(await store.saveFlag(makeFlag(), '2026-09-25T10:00:00.000Z')).toBeNull()
  })

  it.runIf(enabled)('deletes flags only at the expected version, and bumps the revision', async () => {
    const flag = makeFlag()
    await store.saveFlag(flag, null)
    expect(await store.deleteFlag('new-checkout', '2026-01-01T00:00:00.000Z')).toBeNull()
    expect(await store.getFlag('new-checkout')).toBeDefined()
    expect(await store.deleteFlag('new-checkout', flag.updatedAt)).toBe(2)
    expect(await store.deleteFlag('new-checkout', flag.updatedAt)).toBeNull()
    expect(await store.getFlag('new-checkout')).toBeUndefined()
  })

  it.runIf(enabled)('returns copies, not live references', async () => {
    await store.saveFlag(makeFlag(), null)
    const flag = await store.getFlag('new-checkout')
    flag!.name = 'mutated'
    expect((await store.getFlag('new-checkout'))?.name).toBe('New checkout')
  })

  it.runIf(enabled)('keeps the audit log newest first and filters by flag', async () => {
    for (const [i, flagKey] of ['a', 'b', 'a'].entries()) {
      await store.appendAudit({ id: String(i), at: new Date().toISOString(), actor: 'x', action: 'flag.updated', flagKey, changes: [] })
    }
    expect((await store.listAudit({ limit: 10 })).map((e) => e.id)).toEqual(['2', '1', '0'])
    expect((await store.listAudit({ limit: 10, flagKey: 'a' })).map((e) => e.id)).toEqual(['2', '0'])
    expect(await store.listAudit({ limit: 1 })).toHaveLength(1)
  })

  it.runIf(enabled)('delivers published events to subscribers', async () => {
    let subscribed: Promise<unknown> = Promise.resolve()
    const received = nextEvent<StoreEvent>((listener) => (subscribed = store.subscribe(listener)))
    await subscribed
    await store.publish({ type: 'flags-changed', revision: 3, flagKey: 'x' })
    expect(await received).toEqual({ type: 'flags-changed', revision: 3, flagKey: 'x' })
  })
})
