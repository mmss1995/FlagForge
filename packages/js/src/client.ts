import { evaluateFlag, type EvaluationContext, type EvaluationDetail, type SdkPayload } from '@flagforge/core/engine'

/**
 * - `initializing`: no flags yet, every call returns its default
 * - `ready`: live flags, connected to the server
 * - `stale`: flags from the cache, a bootstrap or a lost connection; still served, may be outdated
 * - `error`: no flags and the server is unreachable (or the SDK key was revoked)
 * - `closed`: `close()` was called
 */
export type ClientStatus = 'initializing' | 'ready' | 'stale' | 'error' | 'closed'

export interface ChangeEvent {
  /** Flags whose value changed for the current context. */
  keys: string[]
  status: ClientStatus
}

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>
type EventSourceConstructor = new (url: string) => EventSource

export interface FlagForgeOptions {
  /** Where the FlagForge server lives, e.g. `https://flags.example.com`. */
  baseUrl: string
  /** The environment's SDK key. It only grants read access to that environment's flags. */
  sdkKey: string
  context: EvaluationContext
  /** Real-time updates over Server-Sent Events. Defaults to on wherever `EventSource` exists. */
  streaming?: boolean
  /** Polling interval used when streaming is off. `0` fetches once. Default 30s. */
  pollIntervalMs?: number
  /** Flags rendered on the server, so the first client render already matches (SSR hydration). */
  bootstrap?: SdkPayload
  /** Keeps the last payload so the app starts with real flags even offline. Defaults to `localStorage` when available. */
  storage?: KeyValueStorage | null
  fetch?: typeof fetch
  EventSource?: EventSourceConstructor
  logger?: Pick<Console, 'warn' | 'error'>
}

type Listener = (event: ChangeEvent) => void

const CLOSED = 2 // EventSource.CLOSED, without relying on the global in non-browser runtimes
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30_000

/**
 * Downloads the environment's rules once and evaluates flags locally, so `variation()` is a
 * synchronous in-memory call and changing the context (login, plan upgrade) needs no round trip.
 */
export class FlagForgeClient {
  private payload: SdkPayload | undefined
  private context: EvaluationContext
  private status: ClientStatus = 'initializing'
  private listeners = new Set<Listener>()
  private readyWaiters: (() => void)[] = []
  private eventSource: EventSource | undefined
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private reconnectDelayMs = RECONNECT_MIN_MS
  /** The first payload of every (re)connection is authoritative, even if its version is lower. */
  private acceptNextLive = true
  private readonly storageKey: string
  private readonly storage: KeyValueStorage | null
  private readonly fetchImpl: typeof fetch
  private readonly logger: Pick<Console, 'warn' | 'error'>
  private revisionCounter = 0

  constructor(private readonly options: FlagForgeOptions) {
    this.context = options.context
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.logger = options.logger ?? console
    this.storage = options.storage === undefined ? defaultStorage() : options.storage
    // Scoped to server and key, so two environments or servers never share a cached payload.
    this.storageKey = `flagforge:${trimSlash(options.baseUrl)}:${options.sdkKey}`

    const initial = options.bootstrap ?? this.readCache()
    if (initial) this.apply(initial, 'stale')

    const EventSourceImpl = options.EventSource ?? (globalThis as { EventSource?: EventSourceConstructor }).EventSource
    const streaming = options.streaming ?? Boolean(EventSourceImpl)
    if (streaming && EventSourceImpl) this.connect(EventSourceImpl)
    else void this.poll()
  }

  /**
   * Resolves once flags are available (from the server, a bootstrap or the cache), or after
   * `timeoutMs`, whichever comes first. It never rejects: without flags every call serves its default.
   */
  ready(timeoutMs = 5000): Promise<ClientStatus> {
    if (this.status !== 'initializing') return Promise.resolve(this.status)
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.status), timeoutMs)
      this.readyWaiters.push(() => {
        clearTimeout(timer)
        resolve(this.status)
      })
    })
  }

  variation<T>(key: string, defaultValue: T): T {
    return this.variationDetail(key, defaultValue).value
  }

  /** Like `variation`, plus which variation was served and why. Handy for debugging and analytics. */
  variationDetail<T>(key: string, defaultValue: T): EvaluationDetail<T> {
    return evaluateFlag(this.payload?.flags[key], this.context, defaultValue)
  }

  /** Every flag's value for the current context. */
  allFlags(): Record<string, unknown> {
    const values: Record<string, unknown> = {}
    for (const [key, flag] of Object.entries(this.payload?.flags ?? {})) {
      values[key] = evaluateFlag(flag, this.context, undefined).value
    }
    return values
  }

  /** Switches to another context (e.g. after login). Re-evaluates locally, no network call. */
  identify(context: EvaluationContext): void {
    const before = this.snapshot()
    this.context = context
    this.emitChanges(before)
  }

  getContext(): EvaluationContext {
    return this.context
  }

  getStatus(): ClientStatus {
    return this.status
  }

  /** Increments on every observable change. Framework bindings use it as a cheap snapshot. */
  get revision(): number {
    return this.revisionCounter
  }

  /** The payload currently in use, e.g. to embed in server-rendered HTML as a `bootstrap`. */
  getPayload(): SdkPayload | undefined {
    return this.payload
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.eventSource?.close()
    clearTimeout(this.pollTimer)
    clearTimeout(this.reconnectTimer)
    this.setStatus('closed')
    this.listeners.clear()
  }

  // ─── Transport ─────────────────────────────────────────────────────────────

  private connect(EventSourceImpl: EventSourceConstructor): void {
    const url = `${trimSlash(this.options.baseUrl)}/sdk/stream?sdkKey=${encodeURIComponent(this.options.sdkKey)}`
    const source = new EventSourceImpl(url)
    this.eventSource = source
    this.acceptNextLive = true

    source.addEventListener('put', (event) => {
      const payload = parsePayload((event as MessageEvent<string>).data)
      if (!payload) return this.logger.warn('[flagforge] ignoring malformed payload from stream')
      // After a reconnect the server may have restarted with a fresh revision counter; within one
      // connection, versions only go up, so anything lower is a stale overlap.
      this.apply(payload, 'ready', this.acceptNextLive)
      this.acceptNextLive = false
      this.reconnectDelayMs = RECONNECT_MIN_MS
    })

    source.addEventListener('revoked', () => {
      this.logger.error('[flagforge] the SDK key was rotated; update the key and reload')
      source.close()
      this.setStatus(this.payload ? 'stale' : 'error')
    })

    source.addEventListener('error', () => {
      if (this.status === 'closed' || source !== this.eventSource) return
      this.acceptNextLive = true
      this.setStatus(this.payload ? 'stale' : 'error')
      // Network errors are retried by the browser itself, but an HTTP error response (a 502 during a
      // deploy) closes the EventSource for good. Then we reconnect ourselves, with backoff.
      if (source.readyState === CLOSED) {
        source.close()
        this.reconnectTimer = setTimeout(() => this.connect(EventSourceImpl), this.reconnectDelayMs)
        this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS)
      }
    })
  }

  private async poll(): Promise<void> {
    try {
      const res = await this.fetchImpl(`${trimSlash(this.options.baseUrl)}/sdk/flags`, {
        headers: { Authorization: this.options.sdkKey },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const payload = parsePayload(await res.text())
      if (!payload) throw new Error('malformed payload')
      // Polls run one after another, so each response is the latest snapshot.
      this.apply(payload, 'ready', true)
    } catch (error) {
      if (this.status === 'closed') return
      this.logger.warn(`[flagforge] could not fetch flags: ${(error as Error).message}`)
      this.setStatus(this.payload ? 'stale' : 'error')
    }

    const interval = this.options.pollIntervalMs ?? 30_000
    if (interval > 0 && this.status !== 'closed') this.pollTimer = setTimeout(() => void this.poll(), interval)
  }

  // ─── State ─────────────────────────────────────────────────────────────────

  private apply(payload: SdkPayload, status: ClientStatus, authoritative = false): void {
    if (this.status === 'closed') return
    if (!authoritative && this.payload && payload.version < this.payload.version) return

    const before = this.snapshot()
    this.payload = payload
    this.status = status
    if (status === 'ready') this.writeCache(payload)
    this.emitChanges(before, true)
    this.resolveReady()
  }

  private setStatus(status: ClientStatus): void {
    if (this.status === status) return
    this.status = status
    this.revisionCounter++
    this.notify({ keys: [], status })
    if (status !== 'initializing') this.resolveReady()
  }

  private snapshot(): Map<string, string> {
    const values = new Map<string, string>()
    for (const [key, flag] of Object.entries(this.payload?.flags ?? {})) {
      const detail = evaluateFlag(flag, this.context, undefined)
      values.set(key, `${detail.variationId}:${JSON.stringify(detail.value)}`)
    }
    return values
  }

  private emitChanges(before: Map<string, string>, statusMayHaveChanged = false): void {
    const after = this.snapshot()
    const keys = [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key))
    if (keys.length === 0 && !statusMayHaveChanged) return
    this.revisionCounter++
    this.notify({ keys, status: this.status })
  }

  private notify(event: ChangeEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        this.logger.error('[flagforge] change listener threw', error)
      }
    }
  }

  private resolveReady(): void {
    const waiters = this.readyWaiters
    this.readyWaiters = []
    for (const resolve of waiters) resolve()
  }

  private readCache(): SdkPayload | undefined {
    try {
      const raw = this.storage?.getItem(this.storageKey)
      return raw ? parsePayload(raw) : undefined
    } catch {
      return undefined
    }
  }

  private writeCache(payload: SdkPayload): void {
    try {
      this.storage?.setItem(this.storageKey, JSON.stringify(payload))
    } catch {
      // Quota exceeded or storage disabled: caching is best effort.
    }
  }
}

export function createClient(options: FlagForgeOptions): FlagForgeClient {
  return new FlagForgeClient(options)
}

/** A structural check rather than full schema validation, to keep Zod out of browser bundles. */
function parsePayload(raw: string): SdkPayload | undefined {
  try {
    const data = JSON.parse(raw) as Partial<SdkPayload>
    if (typeof data.version !== 'number' || typeof data.flags !== 'object' || data.flags === null) return undefined
    return data as SdkPayload
  } catch {
    return undefined
  }
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}
