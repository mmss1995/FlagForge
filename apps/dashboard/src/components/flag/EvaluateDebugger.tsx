import { useMutation } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useState } from 'react'
import type { EvaluationDetail, Flag } from '../../lib/api'
import { formatValue, variationLabel } from '../../lib/format'
import { useApi } from '../../lib/session'
import { Button, Card, ErrorNote, Textarea } from '../ui'

const sampleContext = JSON.stringify({ key: 'user-123', email: 'ada@example.com', country: 'IT', plan: 'pro' }, null, 2)

/** "Why does this user see that?": evaluates the saved configuration for any context. */
export function EvaluateDebugger({ flag, env }: { flag: Flag; env: string }) {
  const api = useApi()
  const [text, setText] = useState(sampleContext)
  const [parseError, setParseError] = useState<string | null>(null)
  const evaluate = useMutation({ mutationFn: (context: Record<string, unknown>) => api.evaluate(flag.key, env, context) })

  function run() {
    try {
      const context = JSON.parse(text) as Record<string, unknown>
      if (typeof context?.key !== 'string' || !context.key) throw new Error('The context needs a string "key".')
      setParseError(null)
      evaluate.mutate(context)
    } catch (error) {
      setParseError(error instanceof SyntaxError ? 'The context is not valid JSON.' : (error as Error).message)
    }
  }

  return (
    <Card title="Test a user" description={<>Evaluates the <strong>saved</strong> {env} configuration for this context.</>}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Textarea aria-label="Evaluation context" rows={8} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          <Button onClick={run} loading={evaluate.isPending}>
            <Play className="size-3.5" /> Evaluate
          </Button>
        </div>
        <div className="space-y-3">
          <ErrorNote error={parseError ?? evaluate.error} />
          {evaluate.data && <Result flag={flag} detail={evaluate.data} />}
          {!evaluate.data && !parseError && !evaluate.error && (
            <p className="text-sm text-zinc-500">Edit the context and press Evaluate to see which variation this user gets, and why.</p>
          )}
        </div>
      </div>
    </Card>
  )
}

function Result({ flag, detail }: { flag: Flag; detail: EvaluationDetail }) {
  return (
    <div className="space-y-2 rounded-lg bg-zinc-50 p-4 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
      <p className="text-xs tracking-wide text-zinc-500 uppercase">Result</p>
      <p className="text-lg font-semibold">{detail.variationId ? variationLabel(flag.variations, detail.variationId) : 'SDK default'}</p>
      <p className="font-mono text-sm break-all">{formatValue(detail.value)}</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{explain(flag, detail)}</p>
    </div>
  )
}

export function explain(flag: Flag, { reason }: EvaluationDetail): string {
  switch (reason.kind) {
    case 'OFF':
      return 'Targeting is off in this environment, so the off variation is served.'
    case 'RULE_MATCH': {
      const envRule = Object.values(flag.environments).flatMap((env) => env.rules).find((rule) => rule.id === reason.ruleId)
      const name = envRule?.description ? `“${envRule.description}”` : `#${reason.ruleIndex + 1}`
      return `Matched rule ${name}${reason.inRollout ? ', then placed by its percentage rollout' : ''}.`
    }
    case 'FALLTHROUGH':
      return reason.inRollout ? 'No rule matched: placed by the default percentage rollout.' : 'No rule matched: served the default rule.'
    case 'FLAG_NOT_FOUND':
      return 'The flag does not exist in this environment.'
    case 'ERROR':
      return `Evaluation failed (${reason.errorKind}); SDKs would serve their default value.`
  }
}
