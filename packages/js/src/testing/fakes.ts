import type { SdkFlag, SdkPayload } from '@flagforge/core/engine'

/** In-memory stand-ins for EventSource and the server, shared by the SDK test suites. */
export class FakeEventSource {
  static instances: FakeEventSource[] = []
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>()
  closed = false
  readyState = 1

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  static latest(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1)
    if (!source) throw new Error('No EventSource was opened')
    return source
  }

  static reset() {
    FakeEventSource.instances = []
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: string, data: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent<string>)
    }
  }

  /** Simulates an HTTP error response: the browser gives up and will not retry on its own. */
  failPermanently() {
    this.readyState = 2
    this.emit('error')
  }

  close() {
    this.closed = true
    this.readyState = 2
  }
}

export function booleanFlag(key: string, overrides: Partial<SdkFlag> = {}): SdkFlag {
  return {
    key,
    salt: 'salt',
    variations: [
      { id: 'on', value: true },
      { id: 'off', value: false },
    ],
    enabled: true,
    offVariationId: 'off',
    rules: [],
    fallthrough: { kind: 'variation', variationId: 'on' },
    ...overrides,
  }
}

export function payload(version: number, ...flags: SdkFlag[]): SdkPayload {
  return { environment: 'production', version, flags: Object.fromEntries(flags.map((flag) => [flag.key, flag])) }
}

export function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

export const silentLogger = { warn: () => {}, error: () => {} }
