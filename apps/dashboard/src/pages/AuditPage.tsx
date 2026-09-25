import { AuditList } from '../components/AuditList'
import { Card, ErrorNote, Spinner } from '../components/ui'
import { useAudit } from '../lib/queries'

export function AuditPage() {
  const { data, isPending, error } = useAudit()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-zinc-500">Every change, who made it and what it did. The last 1,000 entries are kept.</p>
      </div>
      <Card>{isPending ? <Spinner /> : error ? <ErrorNote error={error} /> : <AuditList entries={data ?? []} />}</Card>
    </div>
  )
}
