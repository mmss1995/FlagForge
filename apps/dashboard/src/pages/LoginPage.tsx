import { useState, type FormEvent } from 'react'
import { verifyToken } from '../lib/api'
import { useSession } from '../lib/session'
import { storage } from '../lib/storage'
import { Button, ErrorNote, Field, Input } from '../components/ui'

export function LoginPage() {
  const { signIn } = useSession()
  const [token, setToken] = useState('')
  const [actor, setActor] = useState(() => storage.get('flagforge:actor') ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (!(await verifyToken(token))) {
        setError('That admin token was rejected.')
        return
      }
      storage.set('flagforge:actor', actor.trim())
      signIn({ token, actor: actor.trim() || 'admin' })
    } catch {
      setError('Cannot reach the FlagForge server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-2xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-9" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">FlagForge</h1>
            <p className="text-sm text-zinc-500">Feature flags, forged in real time.</p>
          </div>
        </div>

        <Field label="Your name" hint="Shown in the audit log next to your changes.">
          {(id) => <Input id={id} value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Ada Lovelace" autoComplete="name" />}
        </Field>

        <Field label="Admin token" hint={<>The server's <code>ADMIN_TOKEN</code>. Locally: <code>dev-admin-token</code>.</>}>
          {(id) => <Input id={id} type="password" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="current-password" />}
        </Field>

        {error && <ErrorNote error={error} />}

        <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!token}>
          Sign in
        </Button>
      </form>
    </div>
  )
}
