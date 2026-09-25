import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { createApi, type Api, type Session } from './api'
import { storage } from './storage'

const SESSION_KEY = 'flagforge:session'
const ENV_KEY = 'flagforge:environment'

interface SessionContextValue {
  session: Session | null
  api: Api | null
  signIn(session: Session): void
  signOut(): void
  environment: string | null
  setEnvironment(env: string): void
}

const SessionContext = createContext<SessionContextValue | null>(null)

function readSession(): Session | null {
  try {
    const parsed = JSON.parse(storage.get(SESSION_KEY) ?? 'null') as Session | null
    return parsed?.token ? parsed : null
  } catch {
    return null
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession)
  const [environment, setEnvironmentState] = useState<string | null>(() => storage.get(ENV_KEY))

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      api: session ? createApi(session) : null,
      signIn(next) {
        storage.set(SESSION_KEY, JSON.stringify(next))
        setSession(next)
      },
      signOut() {
        storage.set(SESSION_KEY, null)
        setSession(null)
      },
      environment,
      setEnvironment(env) {
        storage.set(ENV_KEY, env)
        setEnvironmentState(env)
      },
    }),
    [session, environment],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside <SessionProvider>')
  return value
}

/** The API client for the signed-in user. Only call below the authenticated layout. */
export function useApi(): Api {
  const { api } = useSession()
  if (!api) throw new Error('Not signed in')
  return api
}
