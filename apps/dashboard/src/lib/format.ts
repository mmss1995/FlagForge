import type { Serve, Variation } from '@flagforge/core'

const units: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000)
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}

export function formatValue(value: unknown): string {
  if (typeof value === 'string') return value === '' ? '""' : value
  return JSON.stringify(value)
}

export function variationLabel(variations: Variation[], id: string): string {
  const variation = variations.find((v) => v.id === id)
  return variation?.name || id
}

export function describeServe(serve: Serve, variations: Variation[]): string {
  if (serve.kind === 'variation') return variationLabel(variations, serve.variationId)
  return serve.weights
    .filter((w) => w.weight > 0)
    .map((w) => `${variationLabel(variations, w.variationId)} ${w.weight}%`)
    .join(' · ')
}

export type FlagKind = 'boolean' | 'string' | 'number' | 'json'

export function flagKind(variations: Variation[]): FlagKind {
  const types = new Set(variations.map((v) => (v.value === null || typeof v.value === 'object' ? 'json' : typeof v.value)))
  return types.size === 1 ? ([...types][0] as FlagKind) : 'json'
}

/** "New checkout flow" → "new-checkout-flow" */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
