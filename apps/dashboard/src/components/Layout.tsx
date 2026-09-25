import { Flag, History, KeyRound, LogOut, Radio } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useLiveUpdates, type LiveState } from '../lib/live'
import { useCurrentEnvironment, useEnvironments } from '../lib/queries'
import { useSession } from '../lib/session'
import { Button, cx, Select } from './ui'

const nav = [
  { to: '/flags', label: 'Flags', icon: Flag },
  { to: '/audit', label: 'Audit log', icon: History },
  { to: '/environments', label: 'Environments', icon: KeyRound },
]

export function Layout() {
  const live = useLiveUpdates()
  const { session, signOut, setEnvironment } = useSession()
  const { data: environments } = useEnvironments()
  const current = useCurrentEnvironment()

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <aside className="flex flex-col border-b border-zinc-200 bg-white md:sticky md:top-0 md:h-dvh md:border-r md:border-b-0 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2.5 px-5 py-4">
          <img src="/favicon.svg" alt="" className="size-7" />
          <span className="text-lg font-semibold tracking-tight">FlagForge</span>
        </div>

        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0" aria-label="Main">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                  isActive
                    ? 'bg-forge-50 text-forge-700 dark:bg-orange-950/60 dark:text-orange-300'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto hidden space-y-3 border-t border-zinc-200 p-4 md:block dark:border-zinc-800">
          <LiveIndicator state={live} />
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm text-zinc-500" title={session?.actor}>
              {session?.actor}
            </span>
            <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-200 bg-zinc-50/85 px-4 py-3 backdrop-blur md:px-8 dark:border-zinc-800 dark:bg-zinc-950/85">
          <div className="flex items-center gap-2">
            <label htmlFor="env" className="text-sm text-zinc-500">
              Environment
            </label>
            <Select id="env" value={current ?? ''} onChange={(e) => setEnvironment(e.target.value)} className="w-40 py-1.5">
              {environments?.map((env) => (
                <option key={env.key} value={env.key}>
                  {env.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:hidden">
            <LiveIndicator state={live} />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function LiveIndicator({ state }: { state: LiveState }) {
  const label = { connecting: 'Connecting…', live: 'Live updates', offline: 'Reconnecting…' }[state]
  return (
    <div className="flex items-center gap-2 text-xs text-zinc-500" role="status">
      <Radio className={cx('size-3.5', state === 'live' ? 'text-emerald-500' : 'text-amber-500', state !== 'live' && 'animate-pulse')} aria-hidden />
      {label}
    </div>
  )
}
