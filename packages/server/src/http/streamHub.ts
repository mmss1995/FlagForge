import type { Response } from 'express'
import type { FlagService } from '../service'
import type { Store, StoreEvent } from '../store/types'

interface SdkClient {
  res: Response
  environment: string
  sdkKey: string
}

/**
 * Keeps the Server-Sent Events connections this instance holds and pushes to them whenever the
 * store announces a change. Because announcements come from Redis pub/sub, a write handled by any
 * instance reaches SDKs connected to every instance.
 */
export class StreamHub {
  private sdkClients = new Set<SdkClient>()
  private adminClients = new Set<Response>()
  private dirty = false
  private heartbeat: NodeJS.Timeout | undefined
  private unsubscribe: (() => void) | undefined

  constructor(
    private readonly store: Store,
    private readonly service: FlagService,
    private readonly heartbeatMs: number,
  ) {}

  async start(): Promise<void> {
    this.unsubscribe = await this.store.subscribe((event) => void this.onStoreEvent(event))
    this.heartbeat = setInterval(() => {
      // A comment line keeps proxies and load balancers from closing idle connections.
      for (const res of this.allResponses()) res.write(': ping\n\n')
    }, this.heartbeatMs)
    this.heartbeat.unref()
  }

  async addSdkClient(res: Response, environment: string, sdkKey: string): Promise<void> {
    openStream(res)
    const client = { res, environment, sdkKey }
    this.sdkClients.add(client)
    res.on('close', () => this.sdkClients.delete(client))
    const payload = await this.service.getSdkPayload(environment)
    send(res, 'put', payload, payload.version)
  }

  addAdminClient(res: Response): void {
    openStream(res)
    this.adminClients.add(res)
    res.on('close', () => this.adminClients.delete(res))
    send(res, 'ready', { connections: this.connectionCounts() })
  }

  /** Connected SDK streams per environment, on this instance. */
  connectionCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const client of this.sdkClients) counts[client.environment] = (counts[client.environment] ?? 0) + 1
    return counts
  }

  async stop(): Promise<void> {
    clearInterval(this.heartbeat)
    this.unsubscribe?.()
    for (const res of this.allResponses()) res.end()
    this.sdkClients.clear()
    this.adminClients.clear()
  }

  private async onStoreEvent(event: StoreEvent): Promise<void> {
    if (event.type === 'environment-changed') {
      await this.dropRevokedClients(event.environment)
      for (const res of this.adminClients) send(res, 'environment-changed', event)
      return
    }

    for (const res of this.adminClients) send(res, 'flags-changed', event)

    // Several writes in one tick (a bulk edit, a burst of pub/sub messages) become a single push.
    if (this.dirty) return
    this.dirty = true
    await new Promise((resolve) => setImmediate(resolve))
    this.dirty = false
    await this.broadcastPayloads()
  }

  private async broadcastPayloads(): Promise<void> {
    const environments = new Set([...this.sdkClients].map((client) => client.environment))
    for (const environment of environments) {
      const payload = await this.service.getSdkPayload(environment)
      for (const client of this.sdkClients) {
        if (client.environment === environment) send(client.res, 'put', payload, payload.version)
      }
    }
    const connections = this.connectionCounts()
    for (const res of this.adminClients) send(res, 'connections', connections)
  }

  /** After a key rotation, streams opened with the old key are closed; SDKs must reconnect with the new one. */
  private async dropRevokedClients(environment: string): Promise<void> {
    const env = await this.store.getEnvironment(environment)
    for (const client of this.sdkClients) {
      if (client.environment === environment && client.sdkKey !== env?.sdkKey) {
        send(client.res, 'revoked', { reason: 'sdk-key-rotated' })
        client.res.end()
        this.sdkClients.delete(client)
      }
    }
  }

  private *allResponses(): Iterable<Response> {
    for (const client of this.sdkClients) yield client.res
    yield* this.adminClients
  }
}

function openStream(res: Response): void {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tells nginx not to buffer the stream.
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  res.write('retry: 3000\n\n')
}

function send(res: Response, event: string, data: unknown, id?: number): void {
  res.write(`event: ${event}\n${id === undefined ? '' : `id: ${id}\n`}data: ${JSON.stringify(data)}\n\n`)
}
