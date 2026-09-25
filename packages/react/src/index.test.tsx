import { createClient, type FlagForgeClient, type FlagForgeOptions } from '@flagforge/js'
import { booleanFlag, FakeEventSource, payload, silentLogger } from '@flagforge/js/testing'
import { act, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Feature, FlagForgeProvider, useAllFlags, useFlag, useFlagDetail, useFlagsStatus, useIdentify } from './index'

const stringFlag = (key: string, value: string) => booleanFlag(key, { variations: [{ id: 'v', value }], offVariationId: 'v', fallthrough: { kind: 'variation', variationId: 'v' } })

describe('@flagforge/react', () => {
  let client: FlagForgeClient
  let source: FakeEventSource

  beforeEach(() => {
    FakeEventSource.reset()
    client = createClient({
      baseUrl: 'http://flags.test',
      sdkKey: 'sdk-test',
      context: { key: 'user-1' },
      EventSource: FakeEventSource as unknown as FlagForgeOptions['EventSource'],
      storage: null,
      logger: silentLogger,
    })
    source = FakeEventSource.latest()
  })

  afterEach(() => client.close())

  const wrapper = ({ children }: { children: ReactNode }) => <FlagForgeProvider client={client}>{children}</FlagForgeProvider>
  const push = (...args: Parameters<typeof payload>) => act(() => source.emit('put', payload(...args)))

  it('throws a helpful error outside the provider', () => {
    expect(() => renderHook(() => useFlag('a', false))).toThrow(/FlagForgeProvider/)
  })

  it('returns the default until flags arrive, then updates live', () => {
    const { result } = renderHook(() => useFlag('new-checkout', false), { wrapper })
    expect(result.current).toBe(false)
    push(1, booleanFlag('new-checkout'))
    expect(result.current).toBe(true)
    push(2, booleanFlag('new-checkout', { enabled: false }))
    expect(result.current).toBe(false)
  })

  it('does not re-render for changes to other flags', () => {
    push(1, booleanFlag('a'), booleanFlag('b'))
    let renders = 0
    renderHook(() => { renders++; return useFlag('a', false) }, { wrapper })
    const before = renders
    push(2, booleanFlag('a'), booleanFlag('b', { enabled: false }))
    expect(renders).toBe(before)
  })

  it('keeps inline object defaults from looping', () => {
    const { result } = renderHook(() => useFlag('missing', { accent: 'blue' }), { wrapper })
    expect(result.current).toEqual({ accent: 'blue' })
    push(1, booleanFlag('other'))
    expect(result.current).toEqual({ accent: 'blue' })
  })

  it('re-evaluates when the context changes', () => {
    push(1, booleanFlag('pro-only', {
      fallthrough: { kind: 'variation', variationId: 'off' },
      rules: [{ id: 'r', clauses: [{ attribute: 'plan', operator: 'in', values: ['pro'] }], serve: { kind: 'variation', variationId: 'on' } }],
    }))
    const { result } = renderHook(() => ({ value: useFlag('pro-only', false), identify: useIdentify() }), { wrapper })
    expect(result.current.value).toBe(false)
    act(() => result.current.identify({ key: 'user-1', plan: 'pro' }))
    expect(result.current.value).toBe(true)
  })

  it('exposes the evaluation detail with a stable reference', () => {
    push(1, booleanFlag('a'))
    const { result, rerender } = renderHook(() => useFlagDetail('a', false), { wrapper })
    expect(result.current).toEqual({ value: true, variationId: 'on', reason: { kind: 'FALLTHROUGH', inRollout: false } })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('lists all flags and updates when any of them changes', () => {
    push(1, booleanFlag('a'), booleanFlag('b'))
    const { result, rerender } = renderHook(() => useAllFlags(), { wrapper })
    expect(result.current).toEqual({ a: true, b: true })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    push(2, booleanFlag('a'), booleanFlag('b', { enabled: false }))
    expect(result.current).toEqual({ a: true, b: false })
  })

  it('reports the connection status', () => {
    const { result } = renderHook(() => useFlagsStatus(), { wrapper })
    expect(result.current).toBe('initializing')
    push(1)
    expect(result.current).toBe('ready')
    act(() => source.emit('error'))
    expect(result.current).toBe('stale')
  })

  describe('<Feature>', () => {
    it('switches between children and fallback', () => {
      render(<Feature flag="new-checkout" fallback={<p>old</p>}><p>new</p></Feature>, { wrapper })
      expect(screen.getByText('old')).toBeTruthy()
      push(1, booleanFlag('new-checkout'))
      expect(screen.getByText('new')).toBeTruthy()
    })

    it('matches a specific value of a multivariate flag', () => {
      push(1, stringFlag('banner', 'sale'))
      render(<Feature flag="banner" is="sale"><p>on sale</p></Feature>, { wrapper })
      expect(screen.getByText('on sale')).toBeTruthy()
    })

    it('passes the value to a render function', () => {
      push(1, stringFlag('banner', 'Free shipping'))
      render(<Feature<string> flag="banner" defaultValue="">{(text) => <p>{text}</p>}</Feature>, { wrapper })
      expect(screen.getByText('Free shipping')).toBeTruthy()
    })
  })
})
