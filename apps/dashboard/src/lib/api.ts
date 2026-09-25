import type { EvaluationDetail, Flag, Rule, Serve, Variation } from '@flagforge/core'

export type { EvaluationDetail, Flag, Rule, Serve, Variation }

export interface Environment {
  key: string
  name: string
  sdkKey: string
  createdAt: string
  connections: number
}

export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  flagKey?: string
  environment?: string
  changes: string[]
}

export interface ApiIssue {
  path: (string | number)[]
  message: string
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: ApiIssue[] = [],
  ) {
    super(message)
  }
}

export interface Session {
  token: string
  actor: string
}

export type TargetingInput = Partial<{
  enabled: boolean
  offVariationId: string
  rules: (Omit<Rule, 'id'> & { id?: string })[]
  fallthrough: Serve
}> & { expectedUpdatedAt?: string }

export type CreateFlagInput = { key: string; name: string; description?: string; tags?: string[]; variations?: Variation[] }
export type UpdateFlagInput = Partial<Pick<Flag, 'name' | 'description' | 'tags' | 'variations' | 'archived'>> & { expectedUpdatedAt?: string }

/** Thin typed client for the admin API. One instance per signed-in session. */
export function createApi(session: Session) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.token}`,
        'X-FlagForge-Actor': session.actor,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 204) return undefined as T
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const error = data?.error ?? {}
      throw new ApiError(res.status, error.code ?? 'unknown', error.message ?? `Request failed (${res.status})`, error.details ?? [])
    }
    return data as T
  }

  return {
    listEnvironments: () => request<Environment[]>('GET', '/environments'),
    rotateSdkKey: (env: string) => request<Environment>('POST', `/environments/${env}/rotate-sdk-key`),
    listFlags: () => request<Flag[]>('GET', '/flags'),
    getFlag: (key: string) => request<Flag>('GET', `/flags/${key}`),
    createFlag: (input: CreateFlagInput) => request<Flag>('POST', '/flags', input),
    updateFlag: (key: string, input: UpdateFlagInput) => request<Flag>('PATCH', `/flags/${key}`, input),
    deleteFlag: (key: string) => request<void>('DELETE', `/flags/${key}`),
    updateTargeting: (key: string, env: string, input: TargetingInput) => request<Flag>('PATCH', `/flags/${key}/targeting/${env}`, input),
    evaluate: (key: string, environment: string, context: Record<string, unknown>) =>
      request<EvaluationDetail>('POST', `/flags/${key}/evaluate`, { environment, context }),
    listAudit: (params: { flagKey?: string; limit?: number } = {}) => {
      const query = new URLSearchParams()
      if (params.flagKey) query.set('flagKey', params.flagKey)
      if (params.limit) query.set('limit', String(params.limit))
      return request<AuditEntry[]>('GET', `/audit?${query}`)
    },
    streamUrl: () => `/api/stream?token=${encodeURIComponent(session.token)}`,
  }
}

export type Api = ReturnType<typeof createApi>

/** Checks a token without a session object, for the login form. */
export async function verifyToken(token: string): Promise<boolean> {
  const res = await fetch('/api/environments', { headers: { Authorization: `Bearer ${token}` } })
  return res.ok
}
