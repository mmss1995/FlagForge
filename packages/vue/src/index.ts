import type { ClientStatus, EvaluationContext, EvaluationDetail, FlagForgeClient } from '@flagforge/js'
import {
  computed,
  defineComponent,
  inject,
  shallowReadonly,
  shallowRef,
  toValue,
  type App,
  type ComputedRef,
  type InjectionKey,
  type MaybeRefOrGetter,
  type PropType,
  type ShallowRef,
} from 'vue'

export type { ClientStatus, EvaluationContext, EvaluationDetail } from '@flagforge/js'

interface FlagForgeState {
  client: FlagForgeClient
  /** Bumped on every client change. One subscription per app, shared by every composable. */
  revision: Readonly<ShallowRef<number>>
  status: Readonly<ShallowRef<ClientStatus>>
}

const FLAGFORGE: InjectionKey<FlagForgeState> = Symbol('flagforge')

/**
 * `app.use(createFlagForge(client))` makes flags available to every component,
 * through the composables and as `$flag(key, default)` in templates.
 */
export function createFlagForge(client: FlagForgeClient) {
  return {
    install(app: App) {
      const revision = shallowRef(client.revision)
      const status = shallowRef(client.getStatus())
      const unsubscribe = client.subscribe(() => {
        revision.value = client.revision
        status.value = client.getStatus()
      })
      const state: FlagForgeState = { client, revision: shallowReadonly(revision), status: shallowReadonly(status) }

      app.provide(FLAGFORGE, state)
      app.config.globalProperties.$flag = <T>(key: string, defaultValue: T): T => {
        void revision.value // track, so templates re-render on change
        return client.variation(key, defaultValue)
      }
      app.onUnmount?.(unsubscribe)
    },
  }
}

function useState(): FlagForgeState {
  const state = inject(FLAGFORGE, null)
  if (!state) throw new Error('FlagForge is not installed: call app.use(createFlagForge(client))')
  return state
}

export function useFlagForgeClient(): FlagForgeClient {
  return useState().client
}

/** A read-only ref with the flag's value. The key can itself be a ref or getter. */
export function useFlag<T>(key: MaybeRefOrGetter<string>, defaultValue: T): ComputedRef<T> {
  const { client, revision } = useState()
  return computed(() => {
    void revision.value
    return client.variation(toValue(key), defaultValue)
  })
}

export function useFlagDetail<T>(key: MaybeRefOrGetter<string>, defaultValue: T): ComputedRef<EvaluationDetail<T>> {
  const { client, revision } = useState()
  return computed(() => {
    void revision.value
    return client.variationDetail(toValue(key), defaultValue)
  })
}

export function useFlagsStatus(): Readonly<ShallowRef<ClientStatus>> {
  return useState().status
}

export function useIdentify(): (context: EvaluationContext) => void {
  const { client } = useState()
  return (context) => client.identify(context)
}

/**
 * Declarative gate with a `fallback` slot:
 * `<FlagForgeFeature flag="new-checkout"><NewCheckout /><template #fallback><OldCheckout /></template></FlagForgeFeature>`.
 * The default slot also receives `{ value }` for multivariate flags.
 */
export const FlagForgeFeature = defineComponent({
  name: 'FlagForgeFeature',
  props: {
    flag: { type: String, required: true },
    /** Renders the default slot when the flag equals this value. Defaults to `true`. */
    is: { type: [Boolean, String, Number] as PropType<boolean | string | number>, default: undefined },
    /** Always render the default slot, passing the value (for multivariate flags). */
    always: { type: Boolean, default: false },
    defaultValue: { type: null as unknown as PropType<unknown>, default: undefined },
  },
  setup(props, { slots }) {
    const { client, revision } = useState()
    const value = computed(() => {
      void revision.value
      const fallbackDefault = props.is === undefined || typeof props.is === 'boolean' ? false : undefined
      return client.variation(props.flag, props.defaultValue === undefined ? fallbackDefault : props.defaultValue)
    })
    return () => {
      if (props.always) return slots.default?.({ value: value.value })
      const expected = props.is === undefined ? true : props.is
      return Object.is(value.value, expected) ? slots.default?.({ value: value.value }) : slots.fallback?.()
    }
  },
})

declare module 'vue' {
  interface ComponentCustomProperties {
    $flag: <T>(key: string, defaultValue: T) => T
  }
}
