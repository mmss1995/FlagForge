import { describe, expect, it } from 'vitest'
import { describeServe, flagKind, slugify, timeAgo } from './format'

describe('format', () => {
  it('slugifies names into valid flag keys', () => {
    expect(slugify('New checkout flow')).toBe('new-checkout-flow')
    expect(slugify('  Città più bella! ')).toBe('citta-piu-bella')
  })

  it('describes what a rule serves', () => {
    const variations = [{ id: 'on', name: 'On', value: true }, { id: 'off', value: false }]
    expect(describeServe({ kind: 'variation', variationId: 'on' }, variations)).toBe('On')
    expect(
      describeServe({ kind: 'rollout', weights: [{ variationId: 'on', weight: 20 }, { variationId: 'off', weight: 80 }] }, variations),
    ).toBe('On 20% · off 80%')
  })

  it('infers the flag kind from its variations', () => {
    expect(flagKind([{ id: 'a', value: true }])).toBe('boolean')
    expect(flagKind([{ id: 'a', value: 'x' }, { id: 'b', value: 'y' }])).toBe('string')
    expect(flagKind([{ id: 'a', value: { x: 1 } }])).toBe('json')
    expect(flagKind([{ id: 'a', value: 1 }, { id: 'b', value: 'x' }])).toBe('json')
  })

  it('formats relative times', () => {
    const now = Date.parse('2026-09-25T12:00:00Z')
    expect(timeAgo('2026-09-25T11:59:40Z', now)).toBe('just now')
    expect(timeAgo('2026-09-25T11:55:00Z', now)).toBe('5 minutes ago')
    expect(timeAgo('2026-09-23T12:00:00Z', now)).toBe('2 days ago')
  })
})
