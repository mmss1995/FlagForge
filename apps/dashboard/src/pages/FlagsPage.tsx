import { Archive, Flag as FlagIcon, Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CreateFlagDialog } from '../components/flag/CreateFlagDialog'
import { Badge, Button, EmptyState, ErrorNote, Input, Spinner, Switch } from '../components/ui'
import type { Flag } from '../lib/api'
import { describeServe, flagKind, timeAgo } from '../lib/format'
import { useCurrentEnvironment, useFlags, useToggleFlag } from '../lib/queries'

export function FlagsPage() {
  const { data: flags, isPending, error } = useFlags()
  const env = useCurrentEnvironment()
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)

  const tags = useMemo(() => [...new Set(flags?.flatMap((flag) => flag.tags))].sort(), [flags])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (flags ?? []).filter(
      (flag) =>
        flag.archived === showArchived &&
        (!tag || flag.tags.includes(tag)) &&
        (!q || flag.key.includes(q) || flag.name.toLowerCase().includes(q) || flag.description.toLowerCase().includes(q)),
    )
  }, [flags, query, tag, showArchived])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Flags</h1>
          <p className="mt-1 text-sm text-zinc-500">Toggle features and roll them out without a deploy.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New flag
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search flags" className="pl-9" aria-label="Search flags" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button key={t} type="button" onClick={() => setTag(tag === t ? null : t)} aria-pressed={tag === t}>
              <Badge tone={tag === t ? 'orange' : 'zinc'}>#{t}</Badge>
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShowArchived(!showArchived)} aria-pressed={showArchived}>
          <Archive className="size-3.5" /> {showArchived ? 'Showing archived' : 'Show archived'}
        </Button>
      </div>

      <ErrorNote error={error} />

      <div className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
        {isPending ? (
          <Spinner label="Loading flags" />
        ) : visible.length === 0 ? (
          <EmptyState icon={<FlagIcon className="size-5" />} title={flags?.length ? 'No flags match' : 'No flags yet'}>
            {flags?.length ? 'Try another search or tag.' : 'Create your first flag, or run npm run seed for demo data.'}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {visible.map((flag) => (
              <FlagRow key={flag.key} flag={flag} env={env} />
            ))}
          </ul>
        )}
      </div>

      <CreateFlagDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function FlagRow({ flag, env }: { flag: Flag; env: string | undefined }) {
  const toggle = useToggleFlag()
  const config = env ? flag.environments[env] : undefined
  const enabled = toggle.isPending ? Boolean(toggle.variables?.enabled) : Boolean(config?.enabled)

  return (
    <li className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/flags/${flag.key}`} className="font-medium hover:text-forge-600 hover:underline">
            {flag.name}
          </Link>
          <Badge tone="blue">{flagKind(flag.variations)}</Badge>
          {flag.tags.map((t) => (
            <Badge key={t}>#{t}</Badge>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          <code className="font-mono">{flag.key}</code>
          {config && (
            <span>
              {config.enabled
                ? `${config.rules.length ? `${config.rules.length} rule${config.rules.length > 1 ? 's' : ''}, then ` : ''}${describeServe(config.fallthrough, flag.variations)}`
                : `off → ${describeServe({ kind: 'variation', variationId: config.offVariationId }, flag.variations)}`}
            </span>
          )}
          <span>updated {timeAgo(flag.updatedAt)}</span>
        </div>
      </div>
      {config && !flag.archived && env && (
        <Switch
          checked={enabled}
          disabled={toggle.isPending}
          label={`${flag.name} in ${env}`}
          onChange={(next) => toggle.mutate({ key: flag.key, env, enabled: next })}
        />
      )}
    </li>
  )
}
