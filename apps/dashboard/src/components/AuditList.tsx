import { History } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AuditEntry } from '../lib/api'
import { timeAgo } from '../lib/format'
import { Badge, EmptyState } from './ui'

const actionLabels: Record<string, { label: string; tone: 'zinc' | 'green' | 'orange' | 'red' | 'blue' }> = {
  'flag.created': { label: 'Created', tone: 'green' },
  'flag.updated': { label: 'Updated', tone: 'blue' },
  'flag.targeting.updated': { label: 'Targeting', tone: 'orange' },
  'flag.archived': { label: 'Archived', tone: 'zinc' },
  'flag.restored': { label: 'Restored', tone: 'green' },
  'flag.deleted': { label: 'Deleted', tone: 'red' },
  'environment.sdk-key.rotated': { label: 'Key rotated', tone: 'red' },
}

export function AuditList({ entries, showFlag = true }: { entries: AuditEntry[]; showFlag?: boolean }) {
  if (entries.length === 0) {
    return <EmptyState icon={<History className="size-5" />} title="No changes recorded yet" />
  }

  return (
    <ol className="relative space-y-5 border-l border-zinc-200 pl-6 dark:border-zinc-800">
      {entries.map((entry) => {
        const action = actionLabels[entry.action] ?? { label: entry.action, tone: 'zinc' as const }
        return (
          <li key={entry.id} className="relative">
            <span className="absolute top-1.5 -left-[1.9rem] size-2.5 rounded-full bg-zinc-300 ring-4 ring-white dark:bg-zinc-600 dark:ring-zinc-900" />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={action.tone}>{action.label}</Badge>
              {showFlag && entry.flagKey && (
                <Link to={`/flags/${entry.flagKey}`} className="font-mono text-xs hover:text-forge-600 hover:underline">
                  {entry.flagKey}
                </Link>
              )}
              {entry.environment && <Badge>{entry.environment}</Badge>}
              <span className="text-zinc-500">
                by <strong className="font-medium text-zinc-700 dark:text-zinc-300">{entry.actor}</strong> · <time dateTime={entry.at} title={new Date(entry.at).toLocaleString()}>{timeAgo(entry.at)}</time>
              </span>
            </div>
            {entry.changes.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-sm text-zinc-600 dark:text-zinc-400">
                {entry.changes.map((change, i) => (
                  <li key={i} className="font-mono text-xs">
                    {change}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ol>
  )
}
