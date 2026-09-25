import { Eye, EyeOff, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CopyButton, Dialog, ErrorNote, Kbd, Spinner } from '../components/ui'
import type { Environment } from '../lib/api'
import { useEnvironments, useRotateSdkKey } from '../lib/queries'

export function EnvironmentsPage() {
  const { data, isPending, error } = useEnvironments()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Environments</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Each environment has its own targeting and SDK key. SDK keys are read-only and safe to ship in frontend bundles.
        </p>
      </div>
      <ErrorNote error={error} />
      {isPending ? <Spinner /> : data?.map((env) => <EnvironmentCard key={env.key} env={env} />)}
    </div>
  )
}

function EnvironmentCard({ env }: { env: Environment }) {
  const [revealed, setRevealed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const rotate = useRotateSdkKey()
  const masked = `${env.sdkKey.slice(0, env.key.length + 5)}${'•'.repeat(12)}${env.sdkKey.slice(-4)}`

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          {env.name} <Kbd>{env.key}</Kbd>
        </span>
      }
      actions={
        <Badge tone={env.connections > 0 ? 'green' : 'zinc'}>
          {env.connections} live SDK connection{env.connections === 1 ? '' : 's'}
        </Badge>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-100 px-3 py-2 font-mono text-sm dark:bg-zinc-800">{revealed ? env.sdkKey : masked}</code>
        <Button variant="ghost" size="sm" onClick={() => setRevealed(!revealed)} aria-label={revealed ? 'Hide SDK key' : 'Reveal SDK key'}>
          {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
        <CopyButton value={env.sdkKey} label="Copy SDK key" />
        <Button size="sm" onClick={() => setConfirming(true)}>
          <RefreshCw className="size-3.5" /> Rotate
        </Button>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Rotate the ${env.name} SDK key?`}
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={rotate.isPending}
              onClick={async () => {
                await rotate.mutateAsync(env.key)
                setConfirming(false)
                setRevealed(true)
              }}
            >
              Rotate key
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The current key stops working immediately and its {env.connections} open stream{env.connections === 1 ? '' : 's'} will be closed. Apps keep serving their
          cached flags until you deploy the new key.
        </p>
        <ErrorNote error={rotate.error} />
      </Dialog>
    </Card>
  )
}
