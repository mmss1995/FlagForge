import type { Flag } from '@flagforge/core'

export interface Environment {
  key: string
  name: string
  sdkKey: string
  createdAt: string
}

export type AuditAction =
  | 'flag.created'
  | 'flag.updated'
  | 'flag.targeting.updated'
  | 'flag.archived'
  | 'flag.restored'
  | 'flag.deleted'
  | 'environment.sdk-key.rotated'

export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: AuditAction
  flagKey?: string
  environment?: string
  /** Human-readable list of what changed, e.g. `production: rollout on 10% → 25%`. */
  changes: string[]
}

/** Broadcast to every server instance so each one can refresh the SSE clients it holds. */
export type StoreEvent =
  | { type: 'flags-changed'; revision: number; flagKey: string }
  | { type: 'environment-changed'; environment: string }

export interface Store {
  listEnvironments(): Promise<Environment[]>
  getEnvironment(key: string): Promise<Environment | undefined>
  /** Creates the environment only if it does not exist yet. Returns whether it was created. */
  createEnvironment(environment: Environment): Promise<boolean>
  saveEnvironment(environment: Environment): Promise<void>

  listFlags(): Promise<Flag[]>
  getFlag(key: string): Promise<Flag | undefined>
  /**
   * Writes a flag and bumps the global revision atomically.
   * With `expectedUpdatedAt: null` the flag must not exist yet; with a timestamp the stored
   * flag must still carry it (optimistic locking). Returns the new revision, or `null` on conflict.
   */
  saveFlag(flag: Flag, expectedUpdatedAt: string | null): Promise<number | null>
  /**
   * Deletes a flag and bumps the revision, only if it still carries `expectedUpdatedAt`.
   * Returns the new revision, or `null` if it is missing or was changed in the meantime.
   */
  deleteFlag(key: string, expectedUpdatedAt: string): Promise<number | null>
  getRevision(): Promise<number>

  appendAudit(entry: AuditEntry): Promise<void>
  listAudit(options: { limit: number; flagKey?: string }): Promise<AuditEntry[]>

  publish(event: StoreEvent): Promise<void>
  subscribe(listener: (event: StoreEvent) => void): Promise<() => void>

  ping(): Promise<boolean>
  close(): Promise<void>
}

export const AUDIT_LOG_LIMIT = 1000
