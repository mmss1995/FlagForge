import type { Config } from './config'
import { createApp } from './http/app'
import { StreamHub } from './http/streamHub'
import { FlagService } from './service'
import { MemoryStore } from './store/memoryStore'
import { RedisStore } from './store/redisStore'
import type { Store } from './store/types'

/** Wires store, service, stream hub and HTTP app together. Shared by the entrypoint and the tests. */
export async function createServer(config: Config, store: Store = createStore(config)) {
  const service = new FlagService(store)
  await service.ensureEnvironments(config.ENVIRONMENTS, config.SDK_KEYS)

  const hub = new StreamHub(store, service, config.HEARTBEAT_MS)
  await hub.start()

  const app = createApp({ config, service, store, hub })
  return {
    app,
    service,
    store,
    hub,
    async close() {
      await hub.stop()
      await store.close()
    },
  }
}

export function createStore(config: Pick<Config, 'REDIS_URL'>): Store {
  if (config.REDIS_URL) return new RedisStore(config.REDIS_URL)
  console.warn('[flagforge] REDIS_URL is not set: using the in-memory store, data will not survive a restart')
  return new MemoryStore()
}
