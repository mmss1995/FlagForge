import { randomBytes, randomUUID } from 'node:crypto'
import {
  ClauseSchema,
  EnvironmentConfigSchema,
  FLAG_KEY_PATTERN,
  FlagSchema,
  RuleSchema,
  ServeSchema,
  VariationSchema,
  evaluateFlag,
  toSdkFlag,
  toSdkPayload,
  type EnvironmentConfig,
  type EvaluationContext,
  type EvaluationDetail,
  type Flag,
  type SdkPayload,
} from '@flagforge/core'
import { z } from 'zod'
import { describeChanges } from './changes'
import { secureCompare } from './secureCompare'
import { conflict, HttpError, notFound } from './errors'
import type { AuditAction, AuditEntry, Environment, Store } from './store/types'

export const CreateFlagInput = z.object({
  key: z.string().regex(FLAG_KEY_PATTERN, 'lowercase letters, digits, ".", "_" or "-" (max 64)'),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
  /** Defaults to a boolean flag. The first variation is served when on, the last one when off. */
  variations: z.array(VariationSchema).min(1).max(20).optional(),
})
export type CreateFlagInput = z.infer<typeof CreateFlagInput>

export const UpdateFlagInput = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string().min(1).max(32)).max(20).optional(),
  variations: z.array(VariationSchema).min(1).max(20).optional(),
  archived: z.boolean().optional(),
  /** Optimistic locking: reject the write if someone else changed the flag since this timestamp. */
  expectedUpdatedAt: z.iso.datetime().optional(),
})
export type UpdateFlagInput = z.infer<typeof UpdateFlagInput>

export const UpdateTargetingInput = z.object({
  enabled: z.boolean().optional(),
  offVariationId: z.string().optional(),
  rules: z.array(RuleSchema.extend({ id: RuleSchema.shape.id.optional() })).optional(),
  fallthrough: ServeSchema.optional(),
  expectedUpdatedAt: z.iso.datetime().optional(),
})
export type UpdateTargetingInput = z.infer<typeof UpdateTargetingInput>

export const EvaluationContextInput = z
  .object({ key: z.string().min(1).max(256) })
  .catchall(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(ClauseSchema.shape.values.element)]))

const MAX_WRITE_ATTEMPTS = 3

/**
 * Business logic for flags and environments. Transport-agnostic: the HTTP layer only parses
 * requests and maps errors. Every write goes through a compare-and-set on `updatedAt`, records an
 * audit entry and publishes a change event that fans out to SDK streams on every instance.
 */
export class FlagService {
  private payloadCache: { revision: number; flags: Flag[] } | undefined

  constructor(private readonly store: Store) {}

  // ─── Environments ──────────────────────────────────────────────────────────

  async ensureEnvironments(keys: string[], presetSdkKeys: Record<string, string> = {}): Promise<void> {
    for (const key of keys) {
      await this.store.createEnvironment({
        key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        sdkKey: presetSdkKeys[key] ?? generateSdkKey(key),
        createdAt: new Date().toISOString(),
      })
    }
    // Environments created after flags existed start out with every flag switched off.
    const environments = await this.store.listEnvironments()
    for (const flag of await this.store.listFlags()) {
      const missing = environments.filter((env) => !flag.environments[env.key])
      if (missing.length === 0) continue
      await this.write(flag.key, 'system', 'flag.updated', undefined, (current) => {
        for (const env of missing) current.environments[env.key] = defaultTargeting(current)
      })
    }
  }

  listEnvironments(): Promise<Environment[]> {
    return this.store.listEnvironments()
  }

  async findEnvironmentBySdkKey(sdkKey: string): Promise<Environment | undefined> {
    const environments = await this.store.listEnvironments()
    return environments.find((env) => secureCompare(sdkKey, env.sdkKey))
  }

  async rotateSdkKey(envKey: string, actor: string): Promise<Environment> {
    const env = await this.store.getEnvironment(envKey)
    if (!env) throw notFound(`Environment "${envKey}"`)
    const rotated = { ...env, sdkKey: generateSdkKey(envKey) }
    await this.store.saveEnvironment(rotated)
    await this.audit({ actor, action: 'environment.sdk-key.rotated', environment: envKey, changes: [`${envKey}: SDK key rotated`] })
    await this.store.publish({ type: 'environment-changed', environment: envKey })
    return rotated
  }

  // ─── Flags ─────────────────────────────────────────────────────────────────

  async listFlags(): Promise<Flag[]> {
    const flags = await this.store.listFlags()
    return flags.sort((a, b) => a.key.localeCompare(b.key))
  }

  async getFlag(key: string): Promise<Flag> {
    const flag = await this.store.getFlag(key)
    if (!flag) throw notFound(`Flag "${key}"`)
    return flag
  }

  async createFlag(input: CreateFlagInput, actor: string): Promise<Flag> {
    const now = new Date().toISOString()
    const draft = {
      key: input.key,
      name: input.name,
      description: input.description ?? '',
      tags: input.tags ?? [],
      variations: input.variations ?? [
        { id: 'on', name: 'On', value: true },
        { id: 'off', name: 'Off', value: false },
      ],
      salt: randomBytes(8).toString('hex'),
      environments: {} as Record<string, EnvironmentConfig>,
      archived: false,
      createdAt: now,
      updatedAt: now,
    }
    for (const env of await this.store.listEnvironments()) draft.environments[env.key] = defaultTargeting(draft)

    const flag = validate(draft)
    const revision = await this.store.saveFlag(flag, null)
    if (revision === null) throw conflict(`Flag "${flag.key}" already exists`)

    await this.audit({ actor, action: 'flag.created', flagKey: flag.key, changes: [`created with variations ${flag.variations.map((v) => v.id).join(', ')}`] })
    await this.store.publish({ type: 'flags-changed', revision, flagKey: flag.key })
    return flag
  }

  async updateFlag(key: string, input: UpdateFlagInput, actor: string): Promise<Flag> {
    const action: AuditAction = input.archived === true ? 'flag.archived' : input.archived === false ? 'flag.restored' : 'flag.updated'
    return this.write(key, actor, action, input.expectedUpdatedAt, (flag) => {
      if (input.name !== undefined) flag.name = input.name
      if (input.description !== undefined) flag.description = input.description
      if (input.tags !== undefined) flag.tags = input.tags
      if (input.variations !== undefined) flag.variations = input.variations
      if (input.archived !== undefined) flag.archived = input.archived
    })
  }

  async updateTargeting(key: string, envKey: string, input: UpdateTargetingInput, actor: string): Promise<Flag> {
    return this.write(key, actor, 'flag.targeting.updated', input.expectedUpdatedAt, (flag) => {
      const env = flag.environments[envKey]
      if (!env) throw notFound(`Environment "${envKey}"`)
      if (input.enabled !== undefined) env.enabled = input.enabled
      if (input.offVariationId !== undefined) env.offVariationId = input.offVariationId
      if (input.fallthrough !== undefined) env.fallthrough = input.fallthrough
      if (input.rules !== undefined) env.rules = input.rules.map((rule) => ({ ...rule, id: rule.id ?? randomUUID().slice(0, 8) }))
      flag.environments[envKey] = EnvironmentConfigSchema.parse(env)
    }, envKey)
  }

  async deleteFlag(key: string, actor: string): Promise<void> {
    const flag = await this.getFlag(key)
    if (!flag.archived) throw new HttpError(409, 'not_archived', 'Archive the flag before deleting it')
    const revision = await this.store.deleteFlag(key)
    if (revision === null) throw notFound(`Flag "${key}"`)
    await this.audit({ actor, action: 'flag.deleted', flagKey: key, changes: ['deleted'] })
    await this.store.publish({ type: 'flags-changed', revision, flagKey: key })
  }

  // ─── Evaluation ────────────────────────────────────────────────────────────

  async getSdkPayload(envKey: string): Promise<SdkPayload> {
    const { revision, flags } = await this.snapshot()
    return toSdkPayload(flags, envKey, revision)
  }

  async evaluateAll(envKey: string, context: EvaluationContext): Promise<{ version: number; flags: Record<string, EvaluationDetail> }> {
    const payload = await this.getSdkPayload(envKey)
    const flags: Record<string, EvaluationDetail> = {}
    for (const [key, flag] of Object.entries(payload.flags)) flags[key] = evaluateFlag(flag, context, undefined)
    return { version: payload.version, flags }
  }

  async evaluate(key: string, envKey: string, context: EvaluationContext): Promise<EvaluationDetail> {
    const flag = await this.getFlag(key)
    if (!flag.environments[envKey]) throw notFound(`Environment "${envKey}"`)
    return evaluateFlag(toSdkFlag(flag, envKey), context, undefined)
  }

  // ─── Audit ─────────────────────────────────────────────────────────────────

  listAudit(options: { limit: number; flagKey?: string }): Promise<AuditEntry[]> {
    return this.store.listAudit(options)
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  /** Flags are read once per revision, however many SDKs poll or reconnect in between. */
  private async snapshot(): Promise<{ revision: number; flags: Flag[] }> {
    const revision = await this.store.getRevision()
    if (this.payloadCache?.revision !== revision) {
      this.payloadCache = { revision, flags: await this.store.listFlags() }
    }
    return this.payloadCache
  }

  /**
   * Read-modify-write with optimistic locking. When the caller pins `expectedUpdatedAt` a conflict
   * is reported to them; otherwise the mutation is simply replayed on the fresh copy.
   */
  private async write(
    key: string,
    actor: string,
    action: AuditAction,
    expectedUpdatedAt: string | undefined,
    mutate: (flag: Flag) => void,
    environment?: string,
  ): Promise<Flag> {
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
      const before = await this.getFlag(key)
      if (expectedUpdatedAt && before.updatedAt !== expectedUpdatedAt) {
        throw conflict(`Flag "${key}" was changed by someone else. Reload and try again.`)
      }

      const draft = structuredClone(before)
      mutate(draft)
      draft.updatedAt = nextTimestamp(before.updatedAt)
      const after = validate(draft)

      const changes = describeChanges(before, after)
      if (changes.length === 0) return before

      const revision = await this.store.saveFlag(after, before.updatedAt)
      if (revision === null) {
        if (expectedUpdatedAt) throw conflict(`Flag "${key}" was changed by someone else. Reload and try again.`)
        continue
      }

      await this.audit({ actor, action, flagKey: key, environment, changes })
      await this.store.publish({ type: 'flags-changed', revision, flagKey: key })
      return after
    }
    throw conflict(`Flag "${key}" is being changed concurrently. Try again.`)
  }

  private async audit(entry: Omit<AuditEntry, 'id' | 'at'>): Promise<void> {
    await this.store.appendAudit({ id: randomUUID(), at: new Date().toISOString(), ...entry })
  }
}

function defaultTargeting(flag: Pick<Flag, 'variations'>): EnvironmentConfig {
  const first = flag.variations[0]!.id
  const last = flag.variations.at(-1)!.id
  return { enabled: false, offVariationId: last, rules: [], fallthrough: { kind: 'variation', variationId: first } }
}

function validate(draft: unknown): Flag {
  const result = FlagSchema.safeParse(draft)
  if (!result.success) {
    throw new HttpError(400, 'invalid_flag', 'The resulting flag is invalid', result.error.issues)
  }
  return result.data
}

/** `updatedAt` doubles as the lock token, so it must change on every write, even within one millisecond. */
function nextTimestamp(previous: string): string {
  const now = Date.now()
  const prev = Date.parse(previous)
  return new Date(now > prev ? now : prev + 1).toISOString()
}

function generateSdkKey(envKey: string): string {
  return `sdk-${envKey}-${randomBytes(18).toString('base64url')}`
}
