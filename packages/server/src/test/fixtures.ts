import type { Flag } from '@flagforge/core'
import type { Config } from '../config'

export const ADMIN_TOKEN = 'test-admin-token'

export const testConfig: Config = {
  PORT: 0,
  REDIS_URL: undefined,
  ADMIN_TOKEN,
  ENVIRONMENTS: ['development', 'production'],
  SDK_CORS_ORIGINS: ['*'],
  SDK_KEYS: { development: 'sdk-development-test', production: 'sdk-production-test' },
  DASHBOARD_DIR: undefined,
  HEARTBEAT_MS: 60_000,
}

export function makeFlag(overrides: Partial<Flag> = {}): Flag {
  const now = '2026-09-25T10:00:00.000Z'
  return {
    key: 'new-checkout',
    name: 'New checkout',
    description: '',
    tags: [],
    salt: 'salt',
    archived: false,
    createdAt: now,
    updatedAt: now,
    variations: [
      { id: 'on', value: true },
      { id: 'off', value: false },
    ],
    environments: {
      production: { enabled: false, offVariationId: 'off', rules: [], fallthrough: { kind: 'variation', variationId: 'on' } },
    },
    ...overrides,
  }
}

/** Resolves on the next event, or rejects after `ms`. */
export function nextEvent<T>(subscribe: (listener: (value: T) => void) => void, ms = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for event')), ms)
    subscribe((value) => {
      clearTimeout(timer)
      resolve(value)
    })
  })
}
