import { describe, expect, it } from 'vitest'
import { evaluateFlag, matchesClause } from './evaluate'
import type { Clause, SdkFlag } from './schema'

function flag(overrides: Partial<SdkFlag> = {}): SdkFlag {
  return {
    key: 'new-checkout',
    salt: 'abc',
    variations: [
      { id: 'on', value: true },
      { id: 'off', value: false },
    ],
    enabled: true,
    offVariationId: 'off',
    rules: [],
    fallthrough: { kind: 'variation', variationId: 'on' },
    ...overrides,
  }
}

describe('evaluateFlag', () => {
  it('serves the default when the flag does not exist', () => {
    expect(evaluateFlag(undefined, { key: 'u' }, false)).toEqual({
      value: false,
      variationId: null,
      reason: { kind: 'FLAG_NOT_FOUND' },
    })
  })

  it('serves the off variation when the flag is disabled, ignoring rules', () => {
    const f = flag({
      enabled: false,
      rules: [{ id: 'r', clauses: [{ attribute: 'key', operator: 'in', values: ['u'] }], serve: { kind: 'variation', variationId: 'on' } }],
    })
    expect(evaluateFlag(f, { key: 'u' }, true)).toMatchObject({ value: false, variationId: 'off', reason: { kind: 'OFF' } })
  })

  it('serves the fallthrough when no rule matches', () => {
    expect(evaluateFlag(flag(), { key: 'u' }, false)).toMatchObject({
      value: true,
      reason: { kind: 'FALLTHROUGH', inRollout: false },
    })
  })

  it('uses the first matching rule', () => {
    const f = flag({
      variations: [
        { id: 'a', value: 'A' },
        { id: 'b', value: 'B' },
        { id: 'c', value: 'C' },
      ],
      offVariationId: 'a',
      fallthrough: { kind: 'variation', variationId: 'a' },
      rules: [
        { id: 'beta', clauses: [{ attribute: 'plan', operator: 'in', values: ['beta'] }], serve: { kind: 'variation', variationId: 'b' } },
        { id: 'italy', clauses: [{ attribute: 'country', operator: 'in', values: ['IT'] }], serve: { kind: 'variation', variationId: 'c' } },
      ],
    })
    expect(evaluateFlag(f, { key: 'u', plan: 'beta', country: 'IT' }, '')).toMatchObject({
      value: 'B',
      reason: { kind: 'RULE_MATCH', ruleIndex: 0, ruleId: 'beta' },
    })
    expect(evaluateFlag(f, { key: 'u', country: 'IT' }, '').value).toBe('C')
    expect(evaluateFlag(f, { key: 'u', country: 'FR' }, '').value).toBe('A')
  })

  it('requires every clause of a rule to match', () => {
    const f = flag({
      fallthrough: { kind: 'variation', variationId: 'off' },
      rules: [
        {
          id: 'r',
          clauses: [
            { attribute: 'country', operator: 'in', values: ['IT'] },
            { attribute: 'age', operator: 'gte', values: [18] },
          ],
          serve: { kind: 'variation', variationId: 'on' },
        },
      ],
    })
    expect(evaluateFlag(f, { key: 'u', country: 'IT', age: 30 }, false).value).toBe(true)
    expect(evaluateFlag(f, { key: 'u', country: 'IT', age: 12 }, false).value).toBe(false)
  })

  it('splits a percentage rollout close to the configured weights', () => {
    const f = flag({ fallthrough: { kind: 'rollout', weights: [{ variationId: 'on', weight: 25 }, { variationId: 'off', weight: 75 }] } })
    let on = 0
    const n = 10_000
    for (let i = 0; i < n; i++) if (evaluateFlag(f, { key: `user-${i}` }, false).value) on++
    expect(on / n).toBeGreaterThan(0.23)
    expect(on / n).toBeLessThan(0.27)
  })

  it('keeps users in their slice when a rollout grows', () => {
    const at = (weight: number) =>
      flag({ fallthrough: { kind: 'rollout', weights: [{ variationId: 'on', weight }, { variationId: 'off', weight: 100 - weight }] } })
    const users = Array.from({ length: 2000 }, (_, i) => ({ key: `user-${i}` }))
    const enabledAt10 = users.filter((u) => evaluateFlag(at(10), u, false).value)
    // Nobody who had the feature at 10% loses it at 50%.
    expect(enabledAt10.every((u) => evaluateFlag(at(50), u, false).value)).toBe(true)
  })

  it('buckets by a custom attribute so a whole company gets the same variation', () => {
    const f = flag({
      fallthrough: { kind: 'rollout', bucketBy: 'company', weights: [{ variationId: 'on', weight: 50 }, { variationId: 'off', weight: 50 }] },
    })
    const results = new Set(Array.from({ length: 50 }, (_, i) => evaluateFlag(f, { key: `user-${i}`, company: 'acme' }, false).value))
    expect(results.size).toBe(1)
  })

  it('reports inRollout on rollout rules', () => {
    const f = flag({ fallthrough: { kind: 'rollout', weights: [{ variationId: 'on', weight: 100 }] } })
    expect(evaluateFlag(f, { key: 'u' }, false).reason).toEqual({ kind: 'FALLTHROUGH', inRollout: true })
  })

  it('serves the default with WRONG_TYPE when the variation type does not match', () => {
    expect(evaluateFlag(flag(), { key: 'u' }, 'nope')).toEqual({
      value: 'nope',
      variationId: null,
      reason: { kind: 'ERROR', errorKind: 'WRONG_TYPE' },
    })
  })

  it('serves the default with MALFORMED_FLAG when a variation is missing', () => {
    expect(evaluateFlag(flag({ fallthrough: { kind: 'variation', variationId: 'ghost' } }), { key: 'u' }, false).reason).toEqual({
      kind: 'ERROR',
      errorKind: 'MALFORMED_FLAG',
    })
  })

  it('treats objects and arrays as distinct JSON types', () => {
    const f = flag({ variations: [{ id: 'on', value: { theme: 'dark' } }], offVariationId: 'on' })
    expect(evaluateFlag(f, { key: 'u' }, {}).value).toEqual({ theme: 'dark' })
    expect(evaluateFlag(f, { key: 'u' }, []).reason.kind).toBe('ERROR')
  })
})

describe('matchesClause', () => {
  const clause = (operator: Clause['operator'], values: Clause['values'], attribute = 'a'): Clause => ({ attribute, operator, values })

  it.each([
    ['in', ['x', 'y'], 'y', true],
    ['in', ['x'], 'z', false],
    ['in', [42], '42', true],
    ['notIn', ['x'], 'z', true],
    ['notIn', ['x'], 'x', false],
    ['contains', ['@acme'], 'bob@acme.com', true],
    ['notContains', ['@acme'], 'bob@acme.com', false],
    ['startsWith', ['admin-'], 'admin-7', true],
    ['endsWith', ['.it'], 'mario.it', true],
    ['matches', ['^v\\d+$'], 'v12', true],
    ['matches', ['^v\\d+$'], 'vx', false],
    ['matches', ['(unclosed'], 'anything', false],
    ['gt', [10], 11, true],
    ['gte', [10], 10, true],
    ['lt', [10], '9', true],
    ['lte', [10], 11, false],
    ['gt', [10], 'abc', false],
    ['gt', [0], true, false],
  ] as const)('%s %j against %j → %s', (operator, values, actual, expected) => {
    expect(matchesClause(clause(operator, [...values]), { key: 'u', a: actual })).toBe(expected)
  })

  it('matches when any element of an array attribute matches', () => {
    expect(matchesClause(clause('in', ['beta']), { key: 'u', a: ['staff', 'beta'] })).toBe(true)
    expect(matchesClause(clause('notIn', ['beta']), { key: 'u', a: ['staff', 'beta'] })).toBe(false)
  })

  it('never matches a missing attribute, even with a negated operator', () => {
    expect(matchesClause(clause('in', ['x']), { key: 'u' })).toBe(false)
    expect(matchesClause(clause('notIn', ['x']), { key: 'u' })).toBe(false)
    expect(matchesClause(clause('notIn', ['x']), { key: 'u', a: null })).toBe(false)
    expect(matchesClause(clause('notIn', ['x']), { key: 'u', a: [] })).toBe(false)
  })

  it('can target the context key', () => {
    expect(matchesClause(clause('in', ['u-1'], 'key'), { key: 'u-1' })).toBe(true)
  })
})
