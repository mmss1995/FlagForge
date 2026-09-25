import { EventEmitter } from 'node:events'
import type { Flag } from '@flagforge/core'
import { AUDIT_LOG_LIMIT, type AuditEntry, type Environment, type Store, type StoreEvent } from './types'

/** Single-process store for local development and tests. Data lives only as long as the process. */
export class MemoryStore implements Store {
  private environments = new Map<string, Environment>()
  private flags = new Map<string, Flag>()
  private audit: AuditEntry[] = []
  private revision = 0
  private events = new EventEmitter()

  async listEnvironments() {
    return [...this.environments.values()].map(clone)
  }

  async getEnvironment(key: string) {
    const env = this.environments.get(key)
    return env && clone(env)
  }

  async createEnvironment(environment: Environment) {
    if (this.environments.has(environment.key)) return false
    this.environments.set(environment.key, clone(environment))
    return true
  }

  async saveEnvironment(environment: Environment) {
    this.environments.set(environment.key, clone(environment))
  }

  async listFlags() {
    return [...this.flags.values()].map(clone)
  }

  async getFlag(key: string) {
    const flag = this.flags.get(key)
    return flag && clone(flag)
  }

  async saveFlag(flag: Flag, expectedUpdatedAt: string | null) {
    const current = this.flags.get(flag.key)
    if (expectedUpdatedAt === null ? current : current?.updatedAt !== expectedUpdatedAt) return null
    this.flags.set(flag.key, clone(flag))
    return ++this.revision
  }

  async deleteFlag(key: string, expectedUpdatedAt: string) {
    if (this.flags.get(key)?.updatedAt !== expectedUpdatedAt) return null
    this.flags.delete(key)
    return ++this.revision
  }

  async getRevision() {
    return this.revision
  }

  async appendAudit(entry: AuditEntry) {
    this.audit.unshift(clone(entry))
    this.audit.length = Math.min(this.audit.length, AUDIT_LOG_LIMIT)
  }

  async listAudit({ limit, flagKey }: { limit: number; flagKey?: string }) {
    const entries = flagKey ? this.audit.filter((entry) => entry.flagKey === flagKey) : this.audit
    return entries.slice(0, limit).map(clone)
  }

  async publish(event: StoreEvent) {
    // Deliver asynchronously, like a real broker would.
    queueMicrotask(() => this.events.emit('event', event))
  }

  async subscribe(listener: (event: StoreEvent) => void) {
    this.events.on('event', listener)
    return () => void this.events.off('event', listener)
  }

  async ping() {
    return true
  }

  async close() {
    this.events.removeAllListeners()
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}
