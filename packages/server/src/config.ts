import { ENVIRONMENT_KEY_PATTERN } from '@flagforge/core'
import { z } from 'zod'

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  REDIS_URL: z.string().optional().transform((value) => value || undefined),
  ADMIN_TOKEN: z.string().min(8, 'ADMIN_TOKEN must be at least 8 characters'),
  ENVIRONMENTS: z
    .string()
    .default('development,staging,production')
    .transform((value) => value.split(',').map((env) => env.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(ENVIRONMENT_KEY_PATTERN)).min(1)),
  SDK_CORS_ORIGINS: z
    .string()
    .default('*')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean)),
  /**
   * Optional fixed SDK keys, applied only when an environment is first created: `development=sdk-dev-local,staging=...`.
   * Handy for local demos and ephemeral preview stacks; leave unset in production so keys are random.
   */
  SDK_KEYS: z
    .string()
    .default('')
    .transform((value) =>
      Object.fromEntries(
        value
          .split(',')
          .map((pair) => pair.split('=').map((part) => part.trim()))
          .filter((pair): pair is [string, string] => pair.length === 2 && Boolean(pair[0]) && Boolean(pair[1])),
      ),
    ),
  DASHBOARD_DIR: z.string().optional(),
  HEARTBEAT_MS: z.coerce.number().int().positive().default(25_000),
})

export type Config = z.infer<typeof ConfigSchema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env)
  if (!result.success) {
    const details = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')
    throw new Error(`Invalid configuration:\n${details}`)
  }
  return result.data
}
