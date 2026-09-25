import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AuditList } from '../components/AuditList'
import { CodeSnippet } from '../components/CodeSnippet'
import { EvaluateDebugger } from '../components/flag/EvaluateDebugger'
import { FlagSettings } from '../components/flag/FlagSettings'
import { TargetingEditor } from '../components/flag/TargetingEditor'
import { Badge, Card, CopyButton, cx, ErrorNote, Spinner } from '../components/ui'
import { flagKind } from '../lib/format'
import { useAudit, useCurrentEnvironment, useFlag } from '../lib/queries'

const tabs = { targeting: 'Targeting', test: 'Test a user', history: 'History', settings: 'Settings' } as const
type Tab = keyof typeof tabs

export function FlagDetailPage() {
  const { key = '' } = useParams()
  const { data: flag, isPending, error } = useFlag(key)
  const env = useCurrentEnvironment()
  const [tab, setTab] = useState<Tab>('targeting')

  if (isPending) return <Spinner label="Loading flag" />
  if (error || !flag) return <ErrorNote error={error ?? 'Flag not found'} />

  const config = env ? flag.environments[env] : undefined
  const offValue = config ? flag.variations.find((v) => v.id === config.offVariationId)?.value : undefined

  return (
    <div className="space-y-6">
      <div>
        <Link to="/flags" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          <ArrowLeft className="size-3.5" /> All flags
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{flag.name}</h1>
          <Badge tone="blue">{flagKind(flag.variations)}</Badge>
          {flag.archived && <Badge tone="red">archived</Badge>}
          {flag.tags.map((t) => (
            <Badge key={t}>#{t}</Badge>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-1 text-sm text-zinc-500">
          <code className="font-mono">{flag.key}</code>
          <CopyButton value={flag.key} label="Copy flag key" />
        </div>
        {flag.description && <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{flag.description}</p>}
      </div>

      <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        {(Object.keys(tabs) as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors',
              tab === t ? 'border-forge-600 text-forge-700 dark:text-orange-300' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200',
            )}
          >
            {tabs[t]}
          </button>
        ))}
      </div>

      {tab === 'targeting' &&
        (env && config ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
            <TargetingEditor key={`${flag.key}:${env}`} flag={flag} env={env} />
            <aside className="space-y-3">
              <h2 className="text-sm font-semibold">Use it in code</h2>
              <CodeSnippet flagKey={flag.key} defaultValue={offValue} />
              <p className="text-xs text-zinc-500">
                The default in code is served when the flag is missing, archived or the server is unreachable before the first payload.
              </p>
            </aside>
          </div>
        ) : (
          <Spinner />
        ))}
      {tab === 'test' && env && <EvaluateDebugger flag={flag} env={env} />}
      {tab === 'history' && <FlagHistory flagKey={flag.key} />}
      {tab === 'settings' && <FlagSettings key={flag.updatedAt} flag={flag} />}
    </div>
  )
}

function FlagHistory({ flagKey }: { flagKey: string }) {
  const { data, isPending, error } = useAudit(flagKey)
  return (
    <Card title="History">
      {isPending ? <Spinner /> : error ? <ErrorNote error={error} /> : <AuditList entries={data ?? []} showFlag={false} />}
    </Card>
  )
}
