import { randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from '../createServer'
import { RedisStore } from '../store/redisStore'
import { ADMIN_TOKEN, testConfig } from '../test/fixtures'

const redisUrl = process.env.TEST_REDIS_URL

/**
 * Two API instances sharing one Redis: a write handled by instance A must reach an SDK streaming
 * from instance B. This is what makes it safe to run several replicas behind a load balancer.
 */
describe.runIf(redisUrl)('horizontal scaling over Redis pub/sub', () => {
  const cleanups: (() => Promise<void>)[] = []
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  async function instance(prefix: string) {
    const store = new RedisStore(redisUrl!, prefix)
    const server = await createServer(testConfig, store)
    const listener = http.createServer(server.app)
    await new Promise<void>((resolve) => listener.listen(0, resolve))
    cleanups.push(async () => {
      listener.closeAllConnections()
      await new Promise((resolve) => listener.close(resolve))
      await store.clear()
      await server.close()
    })
    return `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
  }

  it('pushes a change written on one instance to streams held by another', async () => {
    const prefix = `fftest:${randomUUID()}:`
    const a = await instance(prefix)
    const b = await instance(prefix)
    const admin = { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' }

    await fetch(`${a}/api/flags`, { method: 'POST', headers: admin, body: JSON.stringify({ key: 'shared', name: 'Shared' }) })

    const controller = new AbortController()
    const res = await fetch(`${b}/sdk/stream?sdkKey=sdk-production-test`, { signal: controller.signal })
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    const puts: { flags: Record<string, { enabled: boolean }> }[] = []
    const reading = (async () => {
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read().catch(() => ({ done: true, value: '' }))
        if (done) return
        buffer += value
        for (const match of buffer.matchAll(/event: put\nid: \d+\ndata: (.*)\n\n/g)) puts.push(JSON.parse(match[1]!))
        buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2)
      }
    })()

    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0]!.flags.shared!.enabled).toBe(false)

    await fetch(`${a}/api/flags/shared/targeting/production`, { method: 'PATCH', headers: admin, body: JSON.stringify({ enabled: true }) })

    await expect.poll(() => puts.length).toBe(2)
    expect(puts[1]!.flags.shared!.enabled).toBe(true)
    controller.abort()
    await reading
  })
})
