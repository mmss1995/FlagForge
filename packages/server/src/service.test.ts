import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FlagService } from './service'
import { MemoryStore } from './store/memoryStore'

describe('FlagService', () => {
  let store: MemoryStore
  let service: FlagService

  beforeEach(async () => {
    store = new MemoryStore()
    service = new FlagService(store)
    await service.ensureEnvironments(['development', 'production'], { development: 'sdk-dev' })
  })

  describe('environments', () => {
    it('creates missing environments with preset or random SDK keys', async () => {
      const envs = await service.listEnvironments()
      expect(envs.map((env) => env.key)).toEqual(['development', 'production'])
      expect(envs[0]?.sdkKey).toBe('sdk-dev')
      expect(envs[1]?.sdkKey).toMatch(/^sdk-production-[\w-]{24}$/)
    })

    it('adds new environments to existing flags, switched off', async () => {
      await service.createFlag({ key: 'f', name: 'F' }, 'me')
      await service.ensureEnvironments(['development', 'production', 'staging'])
      expect((await service.getFlag('f')).environments.staging).toEqual({
        enabled: false,
        offVariationId: 'off',
        rules: [],
        fallthrough: { kind: 'variation', variationId: 'on' },
      })
    })

    it('finds environments by SDK key and rotates keys', async () => {
      expect((await service.findEnvironmentBySdkKey('sdk-dev'))?.key).toBe('development')
      const rotated = await service.rotateSdkKey('development', 'me')
      expect(rotated.sdkKey).not.toBe('sdk-dev')
      expect(await service.findEnvironmentBySdkKey('sdk-dev')).toBeUndefined()
      expect((await service.listAudit({ limit: 1 }))[0]?.action).toBe('environment.sdk-key.rotated')
    })
  })

  describe('createFlag', () => {
    it('creates a boolean flag, off everywhere, and records it', async () => {
      const flag = await service.createFlag({ key: 'new-checkout', name: 'New checkout' }, 'ada')
      expect(flag.variations.map((v) => v.value)).toEqual([true, false])
      expect(Object.values(flag.environments).every((env) => !env.enabled)).toBe(true)
      expect(flag.salt).toMatch(/^[0-9a-f]{16}$/)
      expect(await service.listAudit({ limit: 10 })).toMatchObject([{ actor: 'ada', action: 'flag.created', flagKey: 'new-checkout' }])
    })

    it('serves the first variation when on and the last when off', async () => {
      const flag = await service.createFlag(
        {
          key: 'banner',
          name: 'Banner',
          variations: [
            { id: 'a', value: 'A' },
            { id: 'b', value: 'B' },
            { id: 'none', value: '' },
          ],
        },
        'me',
      )
      expect(flag.environments.production).toMatchObject({ offVariationId: 'none', fallthrough: { variationId: 'a' } })
    })

    it('rejects duplicate keys', async () => {
      await service.createFlag({ key: 'f', name: 'F' }, 'me')
      await expect(service.createFlag({ key: 'f', name: 'F' }, 'me')).rejects.toMatchObject({ status: 409 })
    })

    it('publishes a change event', async () => {
      const listener = vi.fn()
      await store.subscribe(listener)
      await service.createFlag({ key: 'f', name: 'F' }, 'me')
      await vi.waitFor(() => expect(listener).toHaveBeenCalledWith({ type: 'flags-changed', revision: 1, flagKey: 'f' }))
    })
  })

  describe('updateTargeting', () => {
    beforeEach(async () => {
      await service.createFlag({ key: 'f', name: 'F' }, 'me')
    })

    it('turns a flag on in one environment only', async () => {
      const flag = await service.updateTargeting('f', 'production', { enabled: true }, 'ada')
      expect(flag.environments.production?.enabled).toBe(true)
      expect(flag.environments.development?.enabled).toBe(false)
    })

    it('assigns ids to new rules and describes the change', async () => {
      const flag = await service.updateTargeting(
        'f',
        'production',
        {
          rules: [{ description: 'Staff', clauses: [{ attribute: 'email', operator: 'endsWith', values: ['@acme.com'] }], serve: { kind: 'variation', variationId: 'on' } }],
          fallthrough: { kind: 'rollout', weights: [{ variationId: 'on', weight: 10 }, { variationId: 'off', weight: 90 }] },
        },
        'ada',
      )
      expect(flag.environments.production?.rules[0]?.id).toMatch(/^[0-9a-f]{8}$/)
      const [entry] = await service.listAudit({ limit: 1 })
      expect(entry).toMatchObject({ action: 'flag.targeting.updated', environment: 'production', actor: 'ada' })
      expect(entry?.changes).toEqual([
        'production: default serve "on" → rollout on 10% / off 90%',
        'production: rule "Staff" added (serve "on")',
      ])
    })

    it('rejects targeting that references unknown variations', async () => {
      await expect(
        service.updateTargeting('f', 'production', { fallthrough: { kind: 'variation', variationId: 'ghost' } }, 'me'),
      ).rejects.toMatchObject({ status: 400, code: 'invalid_flag' })
    })

    it('rejects unknown environments', async () => {
      await expect(service.updateTargeting('f', 'moon', { enabled: true }, 'me')).rejects.toMatchObject({ status: 404 })
    })

    it('reports a conflict when the caller holds a stale version', async () => {
      const original = await service.getFlag('f')
      await service.updateTargeting('f', 'production', { enabled: true }, 'ada')
      await expect(
        service.updateTargeting('f', 'production', { enabled: false, expectedUpdatedAt: original.updatedAt }, 'bob'),
      ).rejects.toMatchObject({ status: 409 })
    })

    it('does not write or audit a no-op change', async () => {
      const before = await store.getRevision()
      await service.updateTargeting('f', 'production', { enabled: false }, 'me')
      expect(await store.getRevision()).toBe(before)
      expect(await service.listAudit({ limit: 10 })).toHaveLength(1)
    })

    it('replays the mutation when a concurrent write sneaks in', async () => {
      const save = store.saveFlag.bind(store)
      let raced = false
      vi.spyOn(store, 'saveFlag').mockImplementation(async (flag, expected) => {
        if (!raced) {
          raced = true
          // Someone else renames the flag between our read and our write.
          const current = (await store.getFlag('f'))!
          await save({ ...current, name: 'Renamed', updatedAt: new Date(Date.now() + 1000).toISOString() }, current.updatedAt)
        }
        return save(flag, expected)
      })

      const flag = await service.updateTargeting('f', 'production', { enabled: true }, 'me')
      expect(flag.name).toBe('Renamed')
      expect(flag.environments.production?.enabled).toBe(true)
    })
  })

  describe('updateFlag and deleteFlag', () => {
    beforeEach(async () => {
      await service.createFlag({ key: 'f', name: 'F' }, 'me')
    })

    it('refuses to remove a variation that targeting still uses', async () => {
      await expect(service.updateFlag('f', { variations: [{ id: 'on', value: true }] }, 'me')).rejects.toMatchObject({ status: 400 })
    })

    it('only deletes archived flags', async () => {
      await expect(service.deleteFlag('f', 'me')).rejects.toMatchObject({ status: 409, code: 'not_archived' })
      await service.updateFlag('f', { archived: true }, 'me')
      await service.deleteFlag('f', 'me')
      await expect(service.getFlag('f')).rejects.toMatchObject({ status: 404 })
      expect((await service.listAudit({ limit: 3 })).map((e) => e.action)).toEqual(['flag.deleted', 'flag.archived', 'flag.created'])
    })

    it('hides archived flags from SDK payloads', async () => {
      await service.updateFlag('f', { archived: true }, 'me')
      expect((await service.getSdkPayload('production')).flags).toEqual({})
    })
  })

  describe('evaluation', () => {
    beforeEach(async () => {
      await service.createFlag({ key: 'f', name: 'F' }, 'me')
      await service.updateTargeting(
        'f',
        'production',
        { enabled: true, rules: [{ clauses: [{ attribute: 'country', operator: 'in', values: ['IT'] }], serve: { kind: 'variation', variationId: 'off' } }] },
        'me',
      )
    })

    it('evaluates one flag for a context', async () => {
      expect(await service.evaluate('f', 'production', { key: 'u', country: 'IT' })).toMatchObject({ value: false, reason: { kind: 'RULE_MATCH' } })
      expect(await service.evaluate('f', 'production', { key: 'u', country: 'FR' })).toMatchObject({ value: true, reason: { kind: 'FALLTHROUGH' } })
    })

    it('evaluates every flag server-side for clients that should not see the rules', async () => {
      const result = await service.evaluateAll('production', { key: 'u', country: 'IT' })
      expect(result.flags.f).toMatchObject({ value: false, variationId: 'off' })
      expect(result.version).toBe(await store.getRevision())
    })

    it('reads the store once per revision', async () => {
      const listFlags = vi.spyOn(store, 'listFlags')
      await service.getSdkPayload('production')
      await service.getSdkPayload('development')
      expect(listFlags).toHaveBeenCalledTimes(1)
      await service.updateTargeting('f', 'development', { enabled: true }, 'me')
      await service.getSdkPayload('production')
      expect(listFlags).toHaveBeenCalledTimes(2)
    })
  })
})
