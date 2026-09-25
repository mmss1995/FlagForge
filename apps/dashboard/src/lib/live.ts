import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { keys } from './queries'
import { useApi } from './session'

export type LiveState = 'connecting' | 'live' | 'offline'

/**
 * Subscribes to the admin event stream so every open dashboard reflects changes made
 * anywhere (another tab, a teammate, the API) within milliseconds.
 */
export function useLiveUpdates(): LiveState {
  const api = useApi()
  const client = useQueryClient()
  const [state, setState] = useState<LiveState>('connecting')

  useEffect(() => {
    const source = new EventSource(api.streamUrl())
    source.addEventListener('ready', () => setState('live'))
    source.addEventListener('error', () => setState('offline'))
    source.addEventListener('flags-changed', (event) => {
      const { flagKey } = JSON.parse((event as MessageEvent<string>).data) as { flagKey: string }
      void client.invalidateQueries({ queryKey: keys.flags, exact: true })
      void client.invalidateQueries({ queryKey: keys.flag(flagKey) })
      void client.invalidateQueries({ queryKey: ['audit'] })
    })
    source.addEventListener('environment-changed', () => void client.invalidateQueries({ queryKey: keys.environments }))
    source.addEventListener('connections', () => void client.invalidateQueries({ queryKey: keys.environments }))
    return () => source.close()
  }, [api, client])

  return state
}
