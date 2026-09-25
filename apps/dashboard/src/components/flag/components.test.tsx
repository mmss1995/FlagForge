import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import type { Flag, Serve } from '../../lib/api'
import { explain } from './EvaluateDebugger'
import { ServeEditor } from './ServeEditor'

const variations = [
  { id: 'on', name: 'On', value: true },
  { id: 'off', name: 'Off', value: false },
]

function Harness({ initial }: { initial: Serve }) {
  const [serve, setServe] = useState(initial)
  return (
    <>
      <ServeEditor label="Serves" serve={serve} variations={variations} onChange={setServe} />
      <output data-testid="serve">{JSON.stringify(serve)}</output>
    </>
  )
}

const current = () => JSON.parse(screen.getByTestId('serve').textContent!) as Serve

describe('ServeEditor', () => {
  it('switches to an even rollout and keeps the total at 100', () => {
    render(<Harness initial={{ kind: 'variation', variationId: 'on' }} />)
    fireEvent.change(screen.getByLabelText('Serves'), { target: { value: '__rollout' } })
    expect(current()).toEqual({ kind: 'rollout', weights: [{ variationId: 'on', weight: 50 }, { variationId: 'off', weight: 50 }] })

    fireEvent.change(screen.getByLabelText('On percentage value'), { target: { value: '15' } })
    expect(current()).toEqual({ kind: 'rollout', weights: [{ variationId: 'on', weight: 15 }, { variationId: 'off', weight: 85 }] })
  })

  it('stores a custom bucketing attribute, and omits the default one', () => {
    render(<Harness initial={{ kind: 'rollout', weights: [{ variationId: 'on', weight: 50 }, { variationId: 'off', weight: 50 }] }} />)
    const input = screen.getByDisplayValue('key')
    fireEvent.change(input, { target: { value: 'company' } })
    expect(current()).toMatchObject({ bucketBy: 'company' })
    fireEvent.change(input, { target: { value: 'key' } })
    expect(current()).not.toHaveProperty('bucketBy')
  })
})

describe('explain', () => {
  const flag = {
    variations,
    environments: {
      production: {
        enabled: true,
        offVariationId: 'off',
        fallthrough: { kind: 'variation', variationId: 'on' },
        rules: [{ id: 'r1', description: 'Internal staff', clauses: [], serve: { kind: 'variation', variationId: 'on' } }],
      },
    },
  } as unknown as Flag

  it('names the matched rule', () => {
    expect(explain(flag, { value: true, variationId: 'on', reason: { kind: 'RULE_MATCH', ruleId: 'r1', ruleIndex: 0, inRollout: false } })).toBe('Matched rule “Internal staff”.')
  })

  it('explains rollouts and off states', () => {
    expect(explain(flag, { value: true, variationId: 'on', reason: { kind: 'FALLTHROUGH', inRollout: true } })).toMatch(/percentage rollout/)
    expect(explain(flag, { value: false, variationId: 'off', reason: { kind: 'OFF' } })).toMatch(/off/)
  })
})
