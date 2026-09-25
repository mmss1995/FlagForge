import { existsSync } from 'node:fs'
import path from 'node:path'
import express, { type ErrorRequestHandler, type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { z, ZodError } from 'zod'
import type { Config } from '../config'
import { HttpError } from '../errors'
import { secureCompare } from '../secureCompare'
import { CreateFlagInput, EvaluationContextInput, UpdateFlagInput, UpdateTargetingInput, type FlagService } from '../service'
import type { Environment, Store } from '../store/types'
import type { StreamHub } from './streamHub'

export interface AppDeps {
  config: Pick<Config, 'ADMIN_TOKEN' | 'SDK_CORS_ORIGINS' | 'DASHBOARD_DIR'>
  service: FlagService
  store: Store
  hub: StreamHub
}

declare module 'express-serve-static-core' {
  interface Locals {
    actor: string
    environment: Environment
  }
}

export function createApp({ config, service, store, hub }: AppDeps) {
  const app = express()
  app.disable('x-powered-by')
  app.use(securityHeaders)
  app.use(express.json({ limit: '256kb' }))

  app.get('/health', async (_req, res) => {
    const storeOk = await store.ping()
    res.status(storeOk ? 200 : 503).json({ status: storeOk ? 'ok' : 'degraded', store: storeOk ? 'ok' : 'unreachable' })
  })

  // ─── SDK API: read-only, authenticated by an environment's SDK key ────────

  const sdk = express.Router()
  sdk.use(cors(config.SDK_CORS_ORIGINS))
  sdk.use(requireSdkKey(service))

  sdk.get('/flags', async (_req, res) => {
    res.set('Cache-Control', 'no-store').json(await service.getSdkPayload(res.locals.environment.key))
  })

  sdk.post('/evaluate', async (req, res) => {
    const { context } = parse(z.object({ context: EvaluationContextInput }), req.body)
    res.set('Cache-Control', 'no-store').json(await service.evaluateAll(res.locals.environment.key, context))
  })

  sdk.get('/stream', async (_req, res) => {
    const env = res.locals.environment
    await hub.addSdkClient(res, env.key, env.sdkKey)
  })

  app.use('/sdk', sdk)

  // ─── Admin API: full control, authenticated by the admin token ────────────

  const admin = express.Router()
  admin.use(requireAdmin(config.ADMIN_TOKEN))

  admin.get('/environments', async (_req, res) => {
    const connections = hub.connectionCounts()
    const environments = await service.listEnvironments()
    res.json(environments.map((env) => ({ ...env, connections: connections[env.key] ?? 0 })))
  })

  admin.post('/environments/:env/rotate-sdk-key', async (req, res) => {
    res.json(await service.rotateSdkKey(param(req, 'env'), res.locals.actor))
  })

  admin.get('/flags', async (_req, res) => {
    res.json(await service.listFlags())
  })

  admin.post('/flags', async (req, res) => {
    res.status(201).json(await service.createFlag(parse(CreateFlagInput, req.body), res.locals.actor))
  })

  admin.get('/flags/:key', async (req, res) => {
    res.json(await service.getFlag(param(req, 'key')))
  })

  admin.patch('/flags/:key', async (req, res) => {
    res.json(await service.updateFlag(param(req, 'key'), parse(UpdateFlagInput, req.body), res.locals.actor))
  })

  admin.delete('/flags/:key', async (req, res) => {
    await service.deleteFlag(param(req, 'key'), res.locals.actor)
    res.status(204).end()
  })

  admin.patch('/flags/:key/targeting/:env', async (req, res) => {
    const input = parse(UpdateTargetingInput, req.body)
    res.json(await service.updateTargeting(param(req, 'key'), param(req, 'env'), input, res.locals.actor))
  })

  admin.post('/flags/:key/evaluate', async (req, res) => {
    const { environment, context } = parse(z.object({ environment: z.string(), context: EvaluationContextInput }), req.body)
    res.json(await service.evaluate(param(req, 'key'), environment, context))
  })

  admin.get('/audit', async (req, res) => {
    const query = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), flagKey: z.string().optional() }),
      req.query,
    )
    res.json(await service.listAudit(query))
  })

  admin.get('/stream', (_req, res) => {
    hub.addAdminClient(res)
  })

  app.use('/api', admin)

  // ─── Dashboard (production build served by the API itself) ────────────────

  const dashboardDir = config.DASHBOARD_DIR && path.resolve(config.DASHBOARD_DIR)
  if (dashboardDir && existsSync(dashboardDir)) {
    app.use(express.static(dashboardDir, { index: false, maxAge: '1h' }))
    app.get(/^\/(?!api\/|sdk\/|health$).*/, (_req, res) => res.sendFile(path.join(dashboardDir, 'index.html')))
  }

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Route not found')))
  app.use(errorHandler)
  return app
}

function requireAdmin(token: string): RequestHandler {
  return (req, res, next) => {
    // EventSource cannot send headers, so the admin stream passes the token as a query parameter.
    const provided = bearer(req) ?? (req.path === '/stream' ? queryString(req, 'token') : undefined)
    if (!provided || !secureCompare(provided, token)) {
      return next(new HttpError(401, 'unauthorized', 'Missing or invalid admin token'))
    }
    res.locals.actor = (req.get('x-flagforge-actor') ?? 'admin').slice(0, 64).trim() || 'admin'
    next()
  }
}

function requireSdkKey(service: FlagService): RequestHandler {
  return async (req, res, next) => {
    const key = bearer(req) ?? req.get('authorization') ?? queryString(req, 'sdkKey')
    const environment = key ? await service.findEnvironmentBySdkKey(key) : undefined
    if (!environment) return next(new HttpError(401, 'unauthorized', 'Missing or invalid SDK key'))
    res.locals.environment = environment
    next()
  }
}

function cors(origins: string[]): RequestHandler {
  const anyOrigin = origins.includes('*')
  return (req, res, next) => {
    const origin = req.get('origin')
    if (origin && (anyOrigin || origins.includes(origin))) {
      res.set({
        'Access-Control-Allow-Origin': anyOrigin ? '*' : origin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      })
    }
    if (req.method === 'OPTIONS') return void res.status(204).end()
    next()
  }
}

function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  })
  next()
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return void res.end()

  if (err instanceof HttpError) {
    return void res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
  }
  if (err instanceof ZodError) {
    return void res.status(400).json({ error: { code: 'invalid_request', message: 'Invalid request', details: err.issues } })
  }
  if (err?.type === 'entity.parse.failed') {
    return void res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } })
  }
  console.error(`[flagforge] ${req.method} ${req.path} failed`, err)
  res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } })
}

function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data)
}

function param(req: Request, name: string): string {
  return String(req.params[name])
}

function bearer(req: Request): string | undefined {
  const header = req.get('authorization')
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined
}

function queryString(req: Request, name: string): string | undefined {
  const value = req.query[name]
  return typeof value === 'string' ? value : undefined
}

