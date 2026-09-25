/**
 * Evaluation without the Zod schemas: what browser SDKs import, so validation code
 * never ends up in an application bundle.
 */
export { evaluateFlag, matchesClause } from './evaluate'
export type { EvaluationDetail, EvaluationReason } from './evaluate'
export { bucket, murmur3 } from './hash'
export type { Clause, ContextValue, EvaluationContext, Operator, Rule, SdkFlag, SdkPayload, Serve, Variation } from './schema'
