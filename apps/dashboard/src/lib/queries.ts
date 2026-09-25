import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { CreateFlagInput, Flag, TargetingInput, UpdateFlagInput } from './api'
import { useApi, useSession } from './session'

export const keys = {
  environments: ['environments'] as const,
  flags: ['flags'] as const,
  flag: (key: string) => ['flags', key] as const,
  audit: (flagKey?: string) => ['audit', flagKey ?? 'all'] as const,
}

export function useEnvironments() {
  const api = useApi()
  return useQuery({ queryKey: keys.environments, queryFn: api.listEnvironments })
}

/** The environment picked in the header, falling back to the first one once environments load. */
export function useCurrentEnvironment(): string | undefined {
  const { environment, setEnvironment } = useSession()
  const { data } = useEnvironments()
  const valid = data?.some((env) => env.key === environment)
  const fallback = data?.find((env) => env.key === 'production')?.key ?? data?.[0]?.key

  useEffect(() => {
    if (data && !valid && fallback) setEnvironment(fallback)
  }, [data, valid, fallback, setEnvironment])

  return valid ? (environment ?? undefined) : fallback
}

export function useFlags() {
  const api = useApi()
  return useQuery({ queryKey: keys.flags, queryFn: api.listFlags })
}

export function useFlag(key: string) {
  const api = useApi()
  return useQuery({ queryKey: keys.flag(key), queryFn: () => api.getFlag(key) })
}

export function useAudit(flagKey?: string) {
  const api = useApi()
  return useQuery({ queryKey: keys.audit(flagKey), queryFn: () => api.listAudit({ flagKey, limit: 200 }) })
}

/** Writes return the updated flag, so caches are updated in place instead of refetched. */
function useFlagWrite<V>(write: (vars: V) => Promise<Flag>) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: write,
    onSuccess(flag) {
      client.setQueryData(keys.flag(flag.key), flag)
      client.setQueryData<Flag[]>(keys.flags, (flags) => flags?.map((f) => (f.key === flag.key ? flag : f)))
      void client.invalidateQueries({ queryKey: ['audit'] })
    },
  })
}

export function useUpdateTargeting(flagKey: string, env: string) {
  const api = useApi()
  return useFlagWrite((input: TargetingInput) => api.updateTargeting(flagKey, env, input))
}

export function useUpdateFlag(flagKey: string) {
  const api = useApi()
  return useFlagWrite((input: UpdateFlagInput) => api.updateFlag(flagKey, input))
}

export function useToggleFlag() {
  const api = useApi()
  return useFlagWrite(({ key, env, enabled }: { key: string; env: string; enabled: boolean }) => api.updateTargeting(key, env, { enabled }))
}

export function useCreateFlag() {
  const api = useApi()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateFlagInput) => api.createFlag(input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.flags }),
  })
}

export function useDeleteFlag() {
  const api = useApi()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => api.deleteFlag(key),
    onSuccess: (_data, key) => {
      client.removeQueries({ queryKey: keys.flag(key) })
      return client.invalidateQueries({ queryKey: keys.flags })
    },
  })
}

export function useRotateSdkKey() {
  const api = useApi()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (env: string) => api.rotateSdkKey(env),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.environments }),
  })
}
