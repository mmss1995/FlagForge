import type { Flag, SdkFlag, SdkPayload } from './schema'

/** Strips a flag down to what an SDK needs for one environment, or `undefined` if it does not apply there. */
export function toSdkFlag(flag: Flag, environment: string): SdkFlag | undefined {
  const env = flag.environments[environment]
  if (!env || flag.archived) return undefined
  return {
    key: flag.key,
    salt: flag.salt,
    variations: flag.variations,
    enabled: env.enabled,
    offVariationId: env.offVariationId,
    rules: env.rules,
    fallthrough: env.fallthrough,
  }
}

export function toSdkPayload(flags: Iterable<Flag>, environment: string, version: number): SdkPayload {
  const projected: Record<string, SdkFlag> = {}
  for (const flag of flags) {
    const sdkFlag = toSdkFlag(flag, environment)
    if (sdkFlag) projected[flag.key] = sdkFlag
  }
  return { environment, version, flags: projected }
}
