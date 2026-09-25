import { createClient, type FlagForgeClient, type FlagForgeOptions } from '@flagforge/js'
import { booleanFlag, FakeEventSource, payload, silentLogger } from '@flagforge/js/testing'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createFlagForge, FlagForgeFeature, useFlag, useFlagDetail, useFlagsStatus, useIdentify } from './index'

const stringFlag = (key: string, value: string) => booleanFlag(key, { variations: [{ id: 'v', value }], offVariationId: 'v', fallthrough: { kind: 'variation', variationId: 'v' } })

describe('@flagforge/vue', () => {
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

  const push = async (...args: Parameters<typeof payload>) => {
    source.emit('put', payload(...args))
    await nextTick()
  }

  /** Mounts a component that runs `setup` and renders whatever it returns as text. */
  function withSetup<T>(setup: () => T) {
    let result!: T
    const wrapper = mount(defineComponent({ setup() { result = setup(); return () => h('div') } }), {
      global: { plugins: [createFlagForge(client)] },
    })
    return { result, wrapper }
  }

  it('throws a helpful error when the plugin is missing', () => {
    expect(() => mount(defineComponent({ setup() { useFlag('a', false); return () => null } }))).toThrow(/createFlagForge/)
  })

  it('returns a ref that updates live', async () => {
    const { result } = withSetup(() => useFlag('new-checkout', false))
    expect(result.value).toBe(false)
    await push(1, booleanFlag('new-checkout'))
    expect(result.value).toBe(true)
    await push(2, booleanFlag('new-checkout', { enabled: false }))
    expect(result.value).toBe(false)
  })

  it('accepts a reactive key', async () => {
    await push(1, booleanFlag('a'), booleanFlag('b', { enabled: false }))
    const key = ref('a')
    const { result } = withSetup(() => useFlag(key, false))
    expect(result.value).toBe(true)
    key.value = 'b'
    expect(result.value).toBe(false)
  })

  it('re-evaluates after identify', async () => {
    await push(1, booleanFlag('pro-only', {
      fallthrough: { kind: 'variation', variationId: 'off' },
      rules: [{ id: 'r', clauses: [{ attribute: 'plan', operator: 'in', values: ['pro'] }], serve: { kind: 'variation', variationId: 'on' } }],
    }))
    const { result } = withSetup(() => ({ value: useFlag('pro-only', false), identify: useIdentify() }))
    expect(result.value.value).toBe(false)
    result.identify({ key: 'user-1', plan: 'pro' })
    expect(result.value.value).toBe(true)
  })

  it('exposes detail and status', async () => {
    const { result } = withSetup(() => ({ detail: useFlagDetail('a', false), status: useFlagsStatus() }))
    expect(result.status.value).toBe('initializing')
    await push(1, booleanFlag('a'))
    expect(result.status.value).toBe('ready')
    expect(result.detail.value.reason).toEqual({ kind: 'FALLTHROUGH', inRollout: false })
  })

  it('provides $flag in templates', async () => {
    const wrapper = mount({ template: '<p>{{ $flag("banner", "none") }}</p>' }, { global: { plugins: [createFlagForge(client)] } })
    expect(wrapper.text()).toBe('none')
    await push(1, stringFlag('banner', 'sale'))
    expect(wrapper.text()).toBe('sale')
  })

  describe('<FlagForgeFeature>', () => {
    const mountFeature = (props: Record<string, unknown>, slots: Record<string, string>) =>
      mount(FlagForgeFeature, { props: props as { flag: string }, slots, global: { plugins: [createFlagForge(client)] } })

    it('switches between the default and fallback slots', async () => {
      const wrapper = mountFeature({ flag: 'new-checkout' }, { default: '<p>new</p>', fallback: '<p>old</p>' })
      expect(wrapper.text()).toBe('old')
      await push(1, booleanFlag('new-checkout'))
      expect(wrapper.text()).toBe('new')
    })

    it('matches a specific value', async () => {
      await push(1, stringFlag('banner', 'sale'))
      const wrapper = mountFeature({ flag: 'banner', is: 'sale' }, { default: '<p>on sale</p>' })
      expect(wrapper.text()).toBe('on sale')
    })

    it('passes the value to the slot with `always`', async () => {
      await push(1, stringFlag('banner', 'Free shipping'))
      const wrapper = mountFeature({ flag: 'banner', always: true, defaultValue: '' }, { default: '<template #default="{ value }"><p>{{ value }}</p></template>' })
      expect(wrapper.text()).toBe('Free shipping')
    })
  })
})
