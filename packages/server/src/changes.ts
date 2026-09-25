import type { EnvironmentConfig, Flag, Serve } from '@flagforge/core'

/** Turns a before/after pair into short, human-readable lines for the audit log. */
export function describeChanges(before: Flag, after: Flag): string[] {
  const changes: string[] = []

  if (before.name !== after.name) changes.push(`name: "${before.name}" → "${after.name}"`)
  if (before.description !== after.description) changes.push('description updated')
  if (JSON.stringify(before.tags) !== JSON.stringify(after.tags)) changes.push(`tags: [${before.tags.join(', ')}] → [${after.tags.join(', ')}]`)
  if (JSON.stringify(before.variations) !== JSON.stringify(after.variations)) changes.push(describeVariations(before, after))
  if (before.archived !== after.archived) changes.push(after.archived ? 'archived' : 'restored')

  const envs = new Set([...Object.keys(before.environments), ...Object.keys(after.environments)])
  for (const env of envs) changes.push(...describeEnvironment(env, before.environments[env], after.environments[env]))

  return changes
}

function describeVariations(before: Flag, after: Flag): string {
  const format = (flag: Flag) => flag.variations.map((v) => `${v.id}=${JSON.stringify(v.value)}`).join(', ')
  return `variations: ${format(before)} → ${format(after)}`
}

function describeEnvironment(env: string, before: EnvironmentConfig | undefined, after: EnvironmentConfig | undefined): string[] {
  if (!before || !after) return [`${env}: ${after ? 'added' : 'removed'}`]

  const changes: string[] = []
  if (before.enabled !== after.enabled) changes.push(`${env}: turned ${after.enabled ? 'ON' : 'OFF'}`)
  if (before.offVariationId !== after.offVariationId) changes.push(`${env}: off variation "${before.offVariationId}" → "${after.offVariationId}"`)
  if (JSON.stringify(before.fallthrough) !== JSON.stringify(after.fallthrough)) {
    changes.push(`${env}: default ${describeServe(before.fallthrough)} → ${describeServe(after.fallthrough)}`)
  }

  const beforeRules = new Map(before.rules.map((rule) => [rule.id, rule]))
  const afterRules = new Map(after.rules.map((rule) => [rule.id, rule]))
  for (const rule of after.rules) {
    const previous = beforeRules.get(rule.id)
    const label = rule.description || rule.id
    if (!previous) changes.push(`${env}: rule "${label}" added (${describeServe(rule.serve)})`)
    else if (JSON.stringify(previous) !== JSON.stringify(rule)) changes.push(`${env}: rule "${label}" updated`)
  }
  for (const rule of before.rules) {
    if (!afterRules.has(rule.id)) changes.push(`${env}: rule "${rule.description || rule.id}" removed`)
  }
  const order = (rules: EnvironmentConfig['rules']) => rules.map((rule) => rule.id).filter((id) => beforeRules.has(id) && afterRules.has(id)).join()
  if (order(before.rules) !== order(after.rules)) changes.push(`${env}: rules reordered`)

  return changes
}

export function describeServe(serve: Serve): string {
  if (serve.kind === 'variation') return `serve "${serve.variationId}"`
  return `rollout ${serve.weights.map((w) => `${w.variationId} ${round(w.weight)}%`).join(' / ')}`
}

const round = (n: number) => Math.round(n * 100) / 100
