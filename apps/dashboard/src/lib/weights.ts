import type { Serve } from '@flagforge/core'

type Weights = Extract<Serve, { kind: 'rollout' }>['weights']

const round = (n: number) => Math.round(n * 100) / 100

/** Splits 100% as evenly as possible, giving rounding leftovers to the first slices. */
export function evenWeights(variationIds: string[]): Weights {
  const base = Math.floor(10_000 / variationIds.length) / 100
  const remainder = round(100 - base * variationIds.length)
  return variationIds.map((variationId, i) => ({ variationId, weight: i === 0 ? round(base + remainder) : base }))
}

/**
 * Sets one slice and rebalances the others proportionally, so the total always stays at 100.
 * Dragging "on" from 10% to 30% in a 10/90 split gives 30/70; in a 10/45/45 split, 30/35/35.
 */
export function setWeight(weights: Weights, index: number, value: number): Weights {
  const target = Math.min(100, Math.max(0, round(value)))
  const others = weights.filter((_, i) => i !== index)
  const othersTotal = others.reduce((sum, w) => sum + w.weight, 0)
  const remaining = round(100 - target)

  const next = weights.map((w, i) => {
    if (i === index) return { ...w, weight: target }
    const share = othersTotal > 0 ? w.weight / othersTotal : 1 / others.length
    return { ...w, weight: round(remaining * share) }
  })

  // Absorb rounding drift in the largest other slice so the sum is exactly 100.
  const drift = round(100 - next.reduce((sum, w) => sum + w.weight, 0))
  if (drift !== 0 && others.length > 0) {
    const largest = next.reduce((best, w, i) => (i !== index && (best < 0 || w.weight > next[best]!.weight) ? i : best), -1)
    next[largest] = { ...next[largest]!, weight: round(next[largest]!.weight + drift) }
  }
  return next
}

export function totalWeight(weights: Weights): number {
  return round(weights.reduce((sum, w) => sum + w.weight, 0))
}
