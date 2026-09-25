import { z } from 'zod'

export const FLAG_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
export const ENVIRONMENT_KEY_PATTERN = /^[a-z][a-z0-9-]{0,31}$/

const id = z.string().min(1).max(64)

export const operators = [
  'in',
  'notIn',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'matches',
  'lt',
  'lte',
  'gt',
  'gte',
] as const

export const OperatorSchema = z.enum(operators)
export type Operator = z.infer<typeof OperatorSchema>

export const VariationSchema = z.object({
  id,
  name: z.string().max(80).optional(),
  value: z.json(),
})
export type Variation = z.infer<typeof VariationSchema>

export const ClauseSchema = z.object({
  attribute: z.string().min(1).max(64),
  operator: OperatorSchema,
  values: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
})
export type Clause = z.infer<typeof ClauseSchema>

export const WeightedVariationSchema = z.object({
  variationId: id,
  weight: z.number().min(0).max(100),
})
export type WeightedVariation = z.infer<typeof WeightedVariationSchema>

/** What a rule (or the fallthrough) serves: one fixed variation, or a percentage rollout. */
export const ServeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('variation'), variationId: id }),
  z.object({
    kind: z.literal('rollout'),
    /** Context attribute used to bucket users. Defaults to `key`. */
    bucketBy: z.string().min(1).max(64).optional(),
    weights: z.array(WeightedVariationSchema).min(1),
  }),
])
export type Serve = z.infer<typeof ServeSchema>

export const RuleSchema = z.object({
  id,
  description: z.string().max(200).optional(),
  /** All clauses must match (logical AND). Use several rules for OR. */
  clauses: z.array(ClauseSchema).min(1),
  serve: ServeSchema,
})
export type Rule = z.infer<typeof RuleSchema>

export const EnvironmentConfigSchema = z.object({
  enabled: z.boolean(),
  offVariationId: id,
  rules: z.array(RuleSchema),
  fallthrough: ServeSchema,
})
export type EnvironmentConfig = z.infer<typeof EnvironmentConfigSchema>

const FlagBaseSchema = z.object({
  key: z.string().regex(FLAG_KEY_PATTERN, 'lowercase letters, digits, ".", "_" or "-" (max 64)'),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).default(''),
  tags: z.array(z.string().min(1).max(32)).max(20).default([]),
  variations: z.array(VariationSchema).min(1).max(20),
  /** Mixed into the bucketing hash so two flags never split users identically. */
  salt: z.string().min(1).max(64),
  environments: z.record(z.string().regex(ENVIRONMENT_KEY_PATTERN), EnvironmentConfigSchema),
  archived: z.boolean().default(false),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export const FlagSchema = FlagBaseSchema.superRefine((flag, ctx) => {
  const variationIds = new Set<string>()
  for (const [i, variation] of flag.variations.entries()) {
    if (variationIds.has(variation.id)) {
      ctx.addIssue({ code: 'custom', path: ['variations', i, 'id'], message: `Duplicate variation id "${variation.id}"` })
    }
    variationIds.add(variation.id)
  }

  for (const [envKey, env] of Object.entries(flag.environments)) {
    const base = ['environments', envKey]
    checkVariationRef(env.offVariationId, variationIds, ctx, [...base, 'offVariationId'])
    checkServe(env.fallthrough, variationIds, ctx, [...base, 'fallthrough'])

    const ruleIds = new Set<string>()
    for (const [i, rule] of env.rules.entries()) {
      if (ruleIds.has(rule.id)) {
        ctx.addIssue({ code: 'custom', path: [...base, 'rules', i, 'id'], message: `Duplicate rule id "${rule.id}"` })
      }
      ruleIds.add(rule.id)
      checkServe(rule.serve, variationIds, ctx, [...base, 'rules', i, 'serve'])
    }
  }
})
export type Flag = z.infer<typeof FlagSchema>

function checkVariationRef(variationId: string, known: Set<string>, ctx: z.RefinementCtx, path: PropertyKey[]) {
  if (!known.has(variationId)) {
    ctx.addIssue({ code: 'custom', path, message: `Unknown variation "${variationId}"` })
  }
}

function checkServe(serve: Serve, known: Set<string>, ctx: z.RefinementCtx, path: PropertyKey[]) {
  if (serve.kind === 'variation') {
    checkVariationRef(serve.variationId, known, ctx, [...path, 'variationId'])
    return
  }
  for (const [i, weighted] of serve.weights.entries()) {
    checkVariationRef(weighted.variationId, known, ctx, [...path, 'weights', i, 'variationId'])
  }
  const total = serve.weights.reduce((sum, w) => sum + w.weight, 0)
  if (Math.abs(total - 100) > 1e-6) {
    ctx.addIssue({ code: 'custom', path: [...path, 'weights'], message: `Rollout weights must add up to 100 (got ${total})` })
  }
}

/** The per-environment projection of a flag that SDKs receive: no names, tags or other environments. */
export const SdkFlagSchema = z.object({
  key: z.string(),
  salt: z.string(),
  variations: z.array(VariationSchema),
  ...EnvironmentConfigSchema.shape,
})
export type SdkFlag = z.infer<typeof SdkFlagSchema>

export const SdkPayloadSchema = z.object({
  environment: z.string(),
  /** Monotonic per environment: SDKs ignore payloads older than the one they hold. */
  version: z.number().int().nonnegative(),
  flags: z.record(z.string(), SdkFlagSchema),
})
export type SdkPayload = z.infer<typeof SdkPayloadSchema>

export type ContextValue = string | number | boolean | null | undefined | readonly (string | number | boolean)[]

/** Who a flag is evaluated for. `key` identifies the subject and is the default bucketing attribute. */
export interface EvaluationContext {
  key: string
  [attribute: string]: ContextValue
}
