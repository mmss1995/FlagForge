import { loadConfig } from './config'
import { createStore } from './createServer'
import { FlagService, type CreateFlagInput, type UpdateTargetingInput } from './service'

/** Demo flags used by the example apps. Safe to run repeatedly: existing flags are left alone. */
const demoFlags: { flag: CreateFlagInput; targeting: Record<string, UpdateTargetingInput> }[] = [
  {
    flag: {
      key: 'new-checkout',
      name: 'New checkout flow',
      description: 'One-page checkout replacing the three-step wizard.',
      tags: ['checkout', 'release'],
    },
    targeting: {
      development: { enabled: true },
      production: {
        enabled: true,
        rules: [
          {
            description: 'Internal staff',
            clauses: [{ attribute: 'email', operator: 'endsWith', values: ['@flagforge.dev'] }],
            serve: { kind: 'variation', variationId: 'on' },
          },
        ],
        fallthrough: {
          kind: 'rollout',
          weights: [
            { variationId: 'on', weight: 20 },
            { variationId: 'off', weight: 80 },
          ],
        },
      },
    },
  },
  {
    flag: {
      key: 'banner-message',
      name: 'Homepage banner',
      description: 'Promotional message shown above the product grid.',
      tags: ['marketing'],
      variations: [
        { id: 'shipping', name: 'Free shipping', value: 'Free shipping on orders over €50' },
        { id: 'sale', name: 'Autumn sale', value: 'Autumn sale: 20% off everything until Sunday' },
        { id: 'none', name: 'No banner', value: '' },
      ],
    },
    targeting: {
      development: { enabled: true },
      staging: { enabled: true },
      production: {
        enabled: true,
        rules: [
          {
            description: 'Italian customers',
            clauses: [{ attribute: 'country', operator: 'in', values: ['IT'] }],
            serve: { kind: 'variation', variationId: 'sale' },
          },
        ],
      },
    },
  },
  {
    flag: {
      key: 'ui-theme',
      name: 'Theme A/B test',
      description: 'Compares the classic blue theme with the new green one.',
      tags: ['experiment', 'design-system'],
      variations: [
        { id: 'classic', name: 'Classic', value: { accent: '#2563eb', radius: 6 } },
        { id: 'fresh', name: 'Fresh', value: { accent: '#059669', radius: 14 } },
      ],
    },
    targeting: {
      development: { enabled: true },
      production: {
        enabled: true,
        fallthrough: {
          kind: 'rollout',
          weights: [
            { variationId: 'classic', weight: 50 },
            { variationId: 'fresh', weight: 50 },
          ],
        },
      },
    },
  },
  {
    flag: {
      key: 'max-cart-items',
      name: 'Cart size limit',
      description: 'Maximum number of items in the cart, raised for Pro customers.',
      tags: ['checkout', 'plans'],
      variations: [
        { id: 'standard', name: 'Standard', value: 10 },
        { id: 'pro', name: 'Pro', value: 25 },
      ],
    },
    targeting: {
      development: {
        enabled: true,
        rules: [
          {
            description: 'Pro plan',
            clauses: [{ attribute: 'plan', operator: 'in', values: ['pro'] }],
            serve: { kind: 'variation', variationId: 'pro' },
          },
        ],
      },
    },
  },
  {
    flag: {
      key: 'maintenance-mode',
      name: 'Maintenance mode',
      description: 'Kill switch: puts the storefront in read-only mode.',
      tags: ['ops', 'kill-switch'],
      variations: [
        { id: 'on', name: 'Maintenance', value: true },
        { id: 'off', name: 'Normal', value: false },
      ],
    },
    targeting: {},
  },
]

const config = loadConfig()
const store = createStore(config)
const service = new FlagService(store)
await service.ensureEnvironments(config.ENVIRONMENTS, config.SDK_KEYS)

const existing = new Set((await service.listFlags()).map((flag) => flag.key))
for (const { flag, targeting } of demoFlags) {
  if (existing.has(flag.key)) {
    console.log(`  skip    ${flag.key} (already exists)`)
    continue
  }
  await service.createFlag(flag, 'seed')
  for (const [env, input] of Object.entries(targeting)) {
    if (config.ENVIRONMENTS.includes(env)) await service.updateTargeting(flag.key, env, input, 'seed')
  }
  console.log(`  created ${flag.key}`)
}

console.log('\nSDK keys:')
for (const env of await service.listEnvironments()) console.log(`  ${env.key.padEnd(12)} ${env.sdkKey}`)
await store.close()
