import type { ClientStatus, EvaluationContext, EvaluationDetail, FlagForgeClient } from '@flagforge/js'
import { createContext, useCallback, useContext, useRef, useSyncExternalStore, type ReactNode } from 'react'

export type { ClientStatus, EvaluationContext, EvaluationDetail } from '@flagforge/js'

const FlagForgeContext = createContext<FlagForgeClient | null>(null)

export interface FlagForgeProviderProps {
  client: FlagForgeClient
  children?: ReactNode
}

/** Makes a client available to every hook below it. Create the client once, outside render. */
export function FlagForgeProvider({ client, children }: FlagForgeProviderProps) {
  return <FlagForgeContext.Provider value={client}>{children}</FlagForgeContext.Provider>
}

export function useFlagForgeClient(): FlagForgeClient {
  const client = useContext(FlagForgeContext)
  if (!client) throw new Error('useFlagForgeClient must be used inside <FlagForgeProvider>')
  return client
}

function useSubscribe(client: FlagForgeClient) {
  return useCallback((onChange: () => void) => client.subscribe(() => onChange()), [client])
}

/**
 * The flag's value for the current context. The component re-renders only when this flag's
 * value changes, not when any other flag does.
 *
 */
export function useFlag<T>(key: string, defaultValue: T): T {
  const client = useFlagForgeClient()
  // Subscribe to the raw variation value: a stable reference from the payload, or undefined when the
  // flag is missing. The typed read below then applies the caller's default and type check.
  const getRawValue = () => client.variationDetail(key, undefined).value
  useSyncExternalStore(useSubscribe(client), getRawValue, getRawValue)
  return client.variation(key, defaultValue)
}

/** The value plus which variation was served and why. Useful for debugging and experiment analytics. */
export function useFlagDetail<T>(key: string, defaultValue: T): EvaluationDetail<T> {
  const client = useFlagForgeClient()
  const cache = useRef<EvaluationDetail<T> | undefined>(undefined)

  const getSnapshot = () => {
    const next = client.variationDetail(key, defaultValue)
    const previous = cache.current
    if (previous && sameDetail(previous, next)) return previous
    cache.current = next
    return next
  }
  return useSyncExternalStore(useSubscribe(client), getSnapshot, getSnapshot)
}

/** Every flag's value for the current context, e.g. for a debug panel or analytics payload. */
export function useAllFlags(): Record<string, unknown> {
  const client = useFlagForgeClient()
  const cache = useRef<{ revision: number; flags: Record<string, unknown> } | undefined>(undefined)

  const getSnapshot = () => {
    if (cache.current?.revision !== client.revision) cache.current = { revision: client.revision, flags: client.allFlags() }
    return cache.current.flags
  }
  return useSyncExternalStore(useSubscribe(client), getSnapshot, getSnapshot)
}

/** Connection state, e.g. to show a banner while flags may be outdated. */
export function useFlagsStatus(): ClientStatus {
  const client = useFlagForgeClient()
  const getSnapshot = () => client.getStatus()
  return useSyncExternalStore(useSubscribe(client), getSnapshot, getSnapshot)
}

/** Returns a stable function that switches the evaluation context (after login, plan change…). */
export function useIdentify(): (context: EvaluationContext) => void {
  const client = useFlagForgeClient()
  return useCallback((context: EvaluationContext) => client.identify(context), [client])
}

export interface FeatureProps<T> {
  flag: string
  /** Renders children when the flag equals this value. Defaults to `true`, for boolean flags. */
  is?: T
  /** Value used while the flag is unknown. Defaults to `false` for boolean flags. */
  defaultValue?: T
  fallback?: ReactNode
  children?: ReactNode | ((value: T) => ReactNode)
}

/**
 * Declarative gate: `<Feature flag="new-checkout" fallback={<OldCheckout />}><NewCheckout /></Feature>`.
 * With a render function as children it renders for any value: `{(banner) => <Banner text={banner} />}`.
 */
export function Feature<T = boolean>({ flag, is, defaultValue, fallback = null, children }: FeatureProps<T>) {
  const value = useFlag<T>(flag, (defaultValue ?? (typeof is === 'boolean' || is === undefined ? false : undefined)) as T)
  if (typeof children === 'function') return <>{children(value)}</>
  const expected = is === undefined ? true : is
  return <>{Object.is(value, expected) ? children : fallback}</>
}

function sameDetail<T>(a: EvaluationDetail<T>, b: EvaluationDetail<T>): boolean {
  return (
    a.variationId === b.variationId &&
    Object.is(a.value, b.value) &&
    JSON.stringify(a.reason) === JSON.stringify(b.reason)
  )
}
