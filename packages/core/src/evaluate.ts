import { bucket } from './hash'
import type { Clause, ContextValue, EvaluationContext, SdkFlag, Serve } from './schema'

export type EvaluationReason =
  | { kind: 'OFF' }
  | { kind: 'RULE_MATCH'; ruleIndex: number; ruleId: string; inRollout: boolean }
  | { kind: 'FALLTHROUGH'; inRollout: boolean }
  | { kind: 'FLAG_NOT_FOUND' }
  | { kind: 'ERROR'; errorKind: 'MALFORMED_FLAG' | 'WRONG_TYPE' }

export interface EvaluationDetail<T = unknown> {
  value: T
  /** `null` when the default value was served (flag missing, malformed or wrong type). */
  variationId: string | null
  reason: EvaluationReason
}

/**
 * Evaluates one flag for one context. Pure and deterministic: the same flag and
 * context always produce the same result, on the server and in every SDK.
 */
export function evaluateFlag<T>(flag: SdkFlag | undefined, context: EvaluationContext, defaultValue: T): EvaluationDetail<T> {
  if (!flag) return { value: defaultValue, variationId: null, reason: { kind: 'FLAG_NOT_FOUND' } }

  let variationId: string | undefined
  let reason: EvaluationReason

  if (!flag.enabled) {
    variationId = flag.offVariationId
    reason = { kind: 'OFF' }
  } else {
    const ruleIndex = flag.rules.findIndex((rule) => rule.clauses.every((clause) => matchesClause(clause, context)))
    const rule = flag.rules[ruleIndex]
    const serve = rule ? rule.serve : flag.fallthrough
    variationId = resolveServe(serve, flag, context)
    const inRollout = serve.kind === 'rollout'
    reason = rule ? { kind: 'RULE_MATCH', ruleIndex, ruleId: rule.id, inRollout } : { kind: 'FALLTHROUGH', inRollout }
  }

  const variation = flag.variations.find((v) => v.id === variationId)
  if (!variation) {
    return { value: defaultValue, variationId: null, reason: { kind: 'ERROR', errorKind: 'MALFORMED_FLAG' } }
  }
  if (!sameJsonType(variation.value, defaultValue)) {
    return { value: defaultValue, variationId: null, reason: { kind: 'ERROR', errorKind: 'WRONG_TYPE' } }
  }
  return { value: variation.value as T, variationId: variation.id, reason }
}

function resolveServe(serve: Serve, flag: SdkFlag, context: EvaluationContext): string | undefined {
  if (serve.kind === 'variation') return serve.variationId

  const attribute = serve.bucketBy ?? 'key'
  const subject = Object.hasOwn(context, attribute) ? context[attribute] : undefined
  // Without a bucketing value we cannot place the subject consistently, so everyone lands in the first slice.
  const position = subject == null ? 0 : bucket(flag.key, flag.salt, String(subject))

  let cumulative = 0
  for (const { variationId, weight } of serve.weights) {
    cumulative += weight
    if (position < cumulative) return variationId
  }
  // Floating point can leave a hair of room at the top: it belongs to the last slice.
  return serve.weights.at(-1)?.variationId
}

const negated: Partial<Record<Clause['operator'], Clause['operator']>> = {
  notIn: 'in',
  notContains: 'contains',
}

/**
 * A clause matches when any of the context values satisfies the operator against any clause value.
 * Negated operators invert that. A missing attribute never matches, negated or not, so a rule
 * like "country notIn [IT]" does not silently catch contexts that carry no country at all.
 */
export function matchesClause(clause: Clause, context: EvaluationContext): boolean {
  // Own properties only: "toString" or "constructor" must not look present on every context.
  const raw: ContextValue = Object.hasOwn(context, clause.attribute) ? context[clause.attribute] : undefined
  if (raw == null) return false
  const actual = Array.isArray(raw) ? raw : [raw as string | number | boolean]
  if (actual.length === 0) return false

  const positive = negated[clause.operator]
  const operator = positive ?? clause.operator
  const hit = actual.some((a) => clause.values.some((expected) => compare(operator, a, expected)))
  return positive ? !hit : hit
}

type Scalar = string | number | boolean

function compare(operator: Clause['operator'], actual: Scalar, expected: Scalar): boolean {
  switch (operator) {
    case 'in':
      return actual === expected || String(actual) === String(expected)
    case 'contains':
      return String(actual).includes(String(expected))
    case 'startsWith':
      return String(actual).startsWith(String(expected))
    case 'endsWith':
      return String(actual).endsWith(String(expected))
    case 'matches':
      return regex(String(expected))?.test(String(actual)) ?? false
    case 'lt':
      return numeric(actual, expected, (a, b) => a < b)
    case 'lte':
      return numeric(actual, expected, (a, b) => a <= b)
    case 'gt':
      return numeric(actual, expected, (a, b) => a > b)
    case 'gte':
      return numeric(actual, expected, (a, b) => a >= b)
    default:
      return false
  }
}

function numeric(actual: Scalar, expected: Scalar, test: (a: number, b: number) => boolean): boolean {
  if (typeof actual === 'boolean' || typeof expected === 'boolean') return false
  const a = Number(actual)
  const b = Number(expected)
  return Number.isFinite(a) && Number.isFinite(b) && test(a, b)
}

const regexCache = new Map<string, RegExp | null>()

function regex(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    let compiled: RegExp | null
    try {
      compiled = new RegExp(pattern)
    } catch {
      compiled = null
    }
    if (regexCache.size > 500) regexCache.clear()
    regexCache.set(pattern, compiled)
  }
  return regexCache.get(pattern) ?? null
}

/** Default values act as the type contract: a string flag never leaks into a boolean call site. */
function sameJsonType(value: unknown, reference: unknown): boolean {
  if (reference === undefined) return true
  return jsonType(value) === jsonType(reference)
}

function jsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
