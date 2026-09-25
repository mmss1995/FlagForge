import type { EnvironmentConfig } from '@flagforge/core'
import { AlertTriangle, Plus, Target } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Flag } from '../../lib/api'
import { variationLabel } from '../../lib/format'
import { useUpdateTargeting } from '../../lib/queries'
import { Badge, Button, Card, EmptyState, ErrorNote, Select, Switch } from '../ui'
import { RuleEditor, type DraftRule } from './RuleEditor'
import { ServeEditor } from './ServeEditor'

type Draft = Omit<EnvironmentConfig, 'rules'> & { rules: DraftRule[] }

/**
 * Edits one environment's targeting as a draft: nothing reaches users until "Save", and the save
 * carries the version it was based on, so a teammate's concurrent change is never silently overwritten.
 */
export function TargetingEditor({ flag, env }: { flag: Flag; env: string }) {
  const saved = flag.environments[env]!
  const [base, setBase] = useState({ updatedAt: flag.updatedAt, config: saved })
  const [draft, setDraft] = useState<Draft>(() => structuredClone(saved))
  const update = useUpdateTargeting(flag.key, env)

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(base.config), [draft, base])
  const staleBase = flag.updatedAt !== base.updatedAt

  // Pick up remote changes automatically unless there are unsaved edits to protect.
  // Adjusting state during render (not in an effect) avoids rendering the stale version first.
  if (staleBase && !dirty) {
    setBase({ updatedAt: flag.updatedAt, config: saved })
    setDraft(structuredClone(saved))
  }

  function reset() {
    setBase({ updatedAt: flag.updatedAt, config: saved })
    setDraft(structuredClone(saved))
    update.reset()
  }

  async function save() {
    const next = await update.mutateAsync({ ...draft, expectedUpdatedAt: base.updatedAt })
    const config = next.environments[env]!
    setBase({ updatedAt: next.updatedAt, config })
    setDraft(structuredClone(config))
  }

  const moveRule = (index: number, direction: -1 | 1) => {
    const rules = [...draft.rules]
    const [rule] = rules.splice(index, 1)
    rules.splice(index + direction, 0, rule!)
    setDraft({ ...draft, rules })
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Switch checked={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} label={`Targeting in ${env}`} />
            <div>
              <p className="font-medium">
                Targeting is {draft.enabled ? 'on' : 'off'} in <span className="capitalize">{env}</span>
              </p>
              <p className="text-sm text-zinc-500">
                {draft.enabled ? 'Rules below are evaluated top to bottom.' : `Everyone gets “${variationLabel(flag.variations, draft.offVariationId)}”.`}
              </p>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm whitespace-nowrap text-zinc-500">
            When off, serve
            <Select value={draft.offVariationId} onChange={(e) => setDraft({ ...draft, offVariationId: e.target.value })} className="w-40 py-1.5">
              {flag.variations.map((v) => (
                <option key={v.id} value={v.id}>
                  {variationLabel(flag.variations, v.id)}
                </option>
              ))}
            </Select>
          </label>
        </div>
      </Card>

      <Card
        title="Rules"
        description="The first matching rule decides. Conditions inside a rule must all match."
        actions={
          <Button
            size="sm"
            onClick={() =>
              setDraft({
                ...draft,
                rules: [...draft.rules, { id: crypto.randomUUID().slice(0, 8), clauses: [{ attribute: 'email', operator: 'endsWith', values: [] }], serve: { kind: 'variation', variationId: flag.variations[0]!.id } }],
              })
            }
          >
            <Plus className="size-3.5" /> Add rule
          </Button>
        }
      >
        {draft.rules.length === 0 ? (
          <EmptyState icon={<Target className="size-5" />} title="No rules">
            Everyone falls through to the default rule. Add a rule to target users by email, country, plan or any attribute you send.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {draft.rules.map((rule, i) => (
              <RuleEditor
                key={rule.id ?? `new-${i}`}
                rule={rule}
                index={i}
                count={draft.rules.length}
                variations={flag.variations}
                onChange={(next) => setDraft({ ...draft, rules: draft.rules.map((r, j) => (j === i ? next : r)) })}
                onRemove={() => setDraft({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })}
                onMove={(direction) => moveRule(i, direction)}
              />
            ))}
          </div>
        )}
      </Card>

      <Card title="Default rule" description="Served to everyone who matches no rule.">
        <ServeEditor label="Default rule serves" serve={draft.fallthrough} variations={flag.variations} onChange={(fallthrough) => setDraft({ ...draft, fallthrough })} />
      </Card>

      {(dirty || update.error) && (
        <div className="sticky bottom-4 z-10 space-y-3 rounded-xl bg-white p-4 shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
          {staleBase && (
            <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="size-4" /> Someone changed this flag while you were editing. Saving will be rejected; discard to load their version.
            </p>
          )}
          <ErrorNote error={update.error} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <Badge tone="orange">Unsaved</Badge> <span className="ml-1 text-zinc-500">Changes apply to <strong className="capitalize">{env}</strong> the moment you save.</span>
            </p>
            <div className="flex gap-2">
              <Button onClick={reset}>Discard</Button>
              <Button variant="primary" onClick={save} loading={update.isPending} disabled={!dirty}>
                Save changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
