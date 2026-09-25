import type { EvaluationContext } from '@flagforge/js'

/** Demo users that exercise the seeded targeting rules. */
export const personas: { label: string; description: string; context: EvaluationContext }[] = [
  {
    label: 'Ada · staff',
    description: 'Matches the “Internal staff” rule: always gets the new checkout.',
    context: { key: 'user-ada', email: 'ada@flagforge.dev', country: 'IT', plan: 'pro' },
  },
  {
    label: 'Bruno · France',
    description: 'No rule matches: placed by the percentage rollout.',
    context: { key: 'user-bruno', email: 'bruno@example.fr', country: 'FR', plan: 'free' },
  },
  {
    label: 'Chiara · Italy',
    description: 'Matches the “Italian customers” banner rule.',
    context: { key: 'user-chiara', email: 'chiara@example.it', country: 'IT', plan: 'free' },
  },
  {
    label: 'Dan · Pro plan',
    description: 'Matches the “Pro plan” rule: larger cart.',
    context: { key: 'user-dan', email: 'dan@example.com', country: 'US', plan: 'pro' },
  },
]

export const config = {
  baseUrl: import.meta.env.VITE_FLAGFORGE_URL ?? 'http://localhost:4000',
  sdkKey: import.meta.env.VITE_FLAGFORGE_SDK_KEY ?? 'sdk-production-demo',
}

export interface Theme {
  accent: string
  radius: number
}

export const defaultTheme: Theme = { accent: '#2563eb', radius: 6 }

export const products = [
  { id: 1, name: 'Anvil mug', price: 18 },
  { id: 2, name: 'Spark notebook', price: 12 },
  { id: 3, name: 'Hammer hoodie', price: 54 },
]
