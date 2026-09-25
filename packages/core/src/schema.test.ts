import { describe, expect, it } from 'vitest'
import { toSdkPayload } from './project'
import { FlagSchema, type Flag } from './schema'

const now = '2026-09-25T10:00:00.000Z'

function validFlag(): Flag {
  return {
    key: 'new-checkout',
    name: 'New checkout',
    description: '',
    tags: [],
    salt: 's',
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
  }
}

describe('FlagSchema', () => {
  it('accepts a valid flag', () => {
    expect(FlagSchema.safeParse(validFlag()).success).toBe(true)
  })

  it('rejects keys that are not URL-safe', () => {
    expect(FlagSchema.safeParse({ ...validFlag(), key: 'New Checkout' }).success).toBe(false)
  })

  it('rejects references to unknown variations', () => {
    const flag = validFlag()
    flag.environments.production!.offVariationId = 'ghost'
    const result = FlagSchema.safeParse(flag)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['environments', 'production', 'offVariationId'])
  })

  it('rejects rollouts whose weights do not add up to 100', () => {
    const flag = validFlag()
    flag.environments.production!.fallthrough = {
      kind: 'rollout',
      weights: [
        { variationId: 'on', weight: 30 },
        { variationId: 'off', weight: 30 },
      ],
    }
    expect(FlagSchema.safeParse(flag).error?.issues[0]?.message).toMatch(/add up to 100/)
  })

  it('accepts fractional weights that add up to 100', () => {
    const flag = validFlag()
    flag.environments.production!.fallthrough = {
      kind: 'rollout',
      weights: [
        { variationId: 'on', weight: 33.3 },
        { variationId: 'off', weight: 66.7 },
      ],
    }
    expect(FlagSchema.safeParse(flag).success).toBe(true)
  })

  it('rejects duplicate variation and rule ids', () => {
    const flag = validFlag()
    flag.variations.push({ id: 'on', value: true })
    expect(FlagSchema.safeParse(flag).success).toBe(false)

    const other = validFlag()
    const rule = { id: 'r', clauses: [{ attribute: 'key', operator: 'in' as const, values: ['x'] }], serve: { kind: 'variation' as const, variationId: 'on' } }
    other.environments.production!.rules = [rule, rule]
    expect(FlagSchema.safeParse(other).success).toBe(false)
  })
})

describe('toSdkPayload', () => {
  it('projects flags for one environment and drops archived or unconfigured ones', () => {
    const archived = { ...validFlag(), key: 'old', archived: true }
    const elsewhere = { ...validFlag(), key: 'staging-only', environments: {} }
    const payload = toSdkPayload([validFlag(), archived, elsewhere], 'production', 7)

    expect(payload.version).toBe(7)
    expect(Object.keys(payload.flags)).toEqual(['new-checkout'])
    expect(payload.flags['new-checkout']).not.toHaveProperty('name')
    expect(payload.flags['new-checkout']).toMatchObject({ enabled: false, offVariationId: 'off' })
  })
})
