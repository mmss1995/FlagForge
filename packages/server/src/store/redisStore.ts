import { FlagSchema, type Flag } from '@flagforge/core'
import { Redis } from 'ioredis'
import { AUDIT_LOG_LIMIT, type AuditEntry, type Environment, type Store, type StoreEvent } from './types'

/**
 * Compare-and-set for flags, executed atomically inside Redis.
 * ARGV[3] is the expected `updatedAt`, or an empty string when the flag must not exist yet.
 */
const SAVE_FLAG_SCRIPT = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if ARGV[3] == '' then
  if current then return -1 end
else
  if not current then return -1 end
  if cjson.decode(current).updatedAt ~= ARGV[3] then return -1 end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
return redis.call('INCR', KEYS[2])
`

const DELETE_FLAG_SCRIPT = `
if redis.call('HDEL', KEYS[1], ARGV[1]) == 0 then return -1 end
return redis.call('INCR', KEYS[2])
`

type Scripts = {
  saveFlag(flagsKey: string, revisionKey: string, key: string, json: string, expected: string): Promise<number>
  deleteFlag(flagsKey: string, revisionKey: string, key: string): Promise<number>
}

/**
 * Redis-backed store. Flags live in one hash, so a full SDK payload is a single HGETALL.
 * Change events go through pub/sub so every API instance can refresh its own SSE clients,
 * which is what lets the server scale horizontally behind a plain load balancer.
 */
export class RedisStore implements Store {
  private readonly redis: Redis & Scripts
  private subscriber: Redis | undefined
  private readonly keys: { flags: string; environments: string; revision: string; audit: string; channel: string }

  constructor(url: string, prefix = 'ff:') {
    this.redis = new Redis(url, { maxRetriesPerRequest: 3 }) as Redis & Scripts
    this.redis.defineCommand('saveFlag', { numberOfKeys: 2, lua: SAVE_FLAG_SCRIPT })
    this.redis.defineCommand('deleteFlag', { numberOfKeys: 2, lua: DELETE_FLAG_SCRIPT })
    this.keys = {
      flags: `${prefix}flags`,
      environments: `${prefix}environments`,
      revision: `${prefix}revision`,
      audit: `${prefix}audit`,
      channel: `${prefix}events`,
    }
  }

  async listEnvironments() {
    const all = await this.redis.hvals(this.keys.environments)
    return all.map((json) => JSON.parse(json) as Environment).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async getEnvironment(key: string) {
    const json = await this.redis.hget(this.keys.environments, key)
    return json ? (JSON.parse(json) as Environment) : undefined
  }

  async createEnvironment(environment: Environment) {
    return (await this.redis.hsetnx(this.keys.environments, environment.key, JSON.stringify(environment))) === 1
  }

  async saveEnvironment(environment: Environment) {
    await this.redis.hset(this.keys.environments, environment.key, JSON.stringify(environment))
  }

  async listFlags() {
    const all = await this.redis.hvals(this.keys.flags)
    return all.map(parseFlag)
  }

  async getFlag(key: string) {
    const json = await this.redis.hget(this.keys.flags, key)
    return json ? parseFlag(json) : undefined
  }

  async saveFlag(flag: Flag, expectedUpdatedAt: string | null) {
    const revision = await this.redis.saveFlag(this.keys.flags, this.keys.revision, flag.key, JSON.stringify(flag), expectedUpdatedAt ?? '')
    return revision < 0 ? null : revision
  }

  async deleteFlag(key: string) {
    const revision = await this.redis.deleteFlag(this.keys.flags, this.keys.revision, key)
    return revision < 0 ? null : revision
  }

  async getRevision() {
    return Number((await this.redis.get(this.keys.revision)) ?? 0)
  }

  async appendAudit(entry: AuditEntry) {
    await this.redis.multi().lpush(this.keys.audit, JSON.stringify(entry)).ltrim(this.keys.audit, 0, AUDIT_LOG_LIMIT - 1).exec()
  }

  async listAudit({ limit, flagKey }: { limit: number; flagKey?: string }) {
    // The log is capped, so filtering in memory stays cheap.
    const all = (await this.redis.lrange(this.keys.audit, 0, -1)).map((json) => JSON.parse(json) as AuditEntry)
    return (flagKey ? all.filter((entry) => entry.flagKey === flagKey) : all).slice(0, limit)
  }

  async publish(event: StoreEvent) {
    await this.redis.publish(this.keys.channel, JSON.stringify(event))
  }

  async subscribe(listener: (event: StoreEvent) => void) {
    // A connection in subscriber mode cannot run other commands, hence the dedicated one.
    this.subscriber ??= this.redis.duplicate()
    const subscriber = this.subscriber
    const onMessage = (channel: string, message: string) => {
      if (channel === this.keys.channel) listener(JSON.parse(message) as StoreEvent)
    }
    subscriber.on('message', onMessage)
    await subscriber.subscribe(this.keys.channel)
    return () => void subscriber.off('message', onMessage)
  }

  async ping() {
    try {
      return (await this.redis.ping()) === 'PONG'
    } catch {
      return false
    }
  }

  async close() {
    await Promise.all([this.subscriber?.quit(), this.redis.quit()])
  }

  /** Test helper: removes every key under this store's prefix. */
  async clear() {
    await this.redis.del(...Object.values(this.keys))
  }
}

function parseFlag(json: string): Flag {
  return FlagSchema.parse(JSON.parse(json))
}
