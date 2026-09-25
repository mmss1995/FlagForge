import type { Clause, Operator } from '@flagforge/core'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import type { Rule, Variation } from '../../lib/api'
import { Button, Input, Select } from '../ui'
import { ServeEditor } from './ServeEditor'

export type DraftRule = Omit<Rule, 'id'> & { id?: string }

const operatorLabels: Record<Operator, string> = {
  in: 'is one of',
  notIn: 'is not one of',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  endsWith: 'ends with',
  matches: 'matches regex',
  lt: '<',
  lte: '≤',
  gt: '>',
  gte: '≥',
}

const numericOperators = new Set<Operator>(['lt', 'lte', 'gt', 'gte'])
const suggestedAttributes = ['key', 'email', 'country', 'plan', 'role', 'appVersion', 'company', 'groups']

export function RuleEditor({
  rule,
  index,
  count,
  variations,
  onChange,
  onRemove,
  onMove,
}: {
  rule: DraftRule
  index: number
  count: number
  variations: Variation[]
  onChange(rule: DraftRule): void
  onRemove(): void
  onMove(direction: -1 | 1): void
}) {
  const updateClause = (i: number, clause: Clause) => onChange({ ...rule, clauses: rule.clauses.map((c, j) => (j === i ? clause : c)) })

  return (
    <div className="rounded-xl ring-1 ring-zinc-200 dark:ring-zinc-800">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <span className="flex size-6 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold dark:bg-zinc-800">{index + 1}</span>
        <Input
          aria-label="Rule description"
          value={rule.description ?? ''}
          placeholder="Describe this rule (e.g. Beta testers)"
          onChange={(e) => onChange({ ...rule, description: e.target.value || undefined })}
          className="flex-1 py-1 ring-0 dark:ring-0"
        />
        <Button variant="ghost" size="sm" aria-label="Move rule up" disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Move rule down" disabled={index === count - 1} onClick={() => onMove(1)}>
          <ArrowDown className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" aria-label="Delete rule" onClick={onRemove}>
          <Trash2 className="size-4 text-red-500" />
        </Button>
      </div>

      <div className="space-y-3 p-4">
        {rule.clauses.map((clause, i) => (
          <ClauseRow
            key={i}
            clause={clause}
            first={i === 0}
            canRemove={rule.clauses.length > 1}
            onChange={(next) => updateClause(i, next)}
            onRemove={() => onChange({ ...rule, clauses: rule.clauses.filter((_, j) => j !== i) })}
          />
        ))}
        <Button variant="ghost" size="sm" onClick={() => onChange({ ...rule, clauses: [...rule.clauses, { attribute: 'email', operator: 'endsWith', values: [] }] })}>
          <Plus className="size-3.5" /> And…
        </Button>

        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <ServeEditor label={`Rule ${index + 1} serves`} serve={rule.serve} variations={variations} onChange={(serve) => onChange({ ...rule, serve })} />
        </div>
      </div>
    </div>
  )
}

function ClauseRow({ clause, first, canRemove, onChange, onRemove }: { clause: Clause; first: boolean; canRemove: boolean; onChange(clause: Clause): void; onRemove(): void }) {
  const [text, setText] = useState(() => clause.values.join(', '))
  const numeric = numericOperators.has(clause.operator)
  const parse = (raw: string, operator: Operator) =>
    raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => (numericOperators.has(operator) && Number.isFinite(Number(v)) ? Number(v) : v))

  return (
    <div className="grid gap-2 sm:grid-cols-[3rem_10rem_10rem_1fr_auto] sm:items-center">
      <span className="text-xs font-semibold text-zinc-500 uppercase">{first ? 'If' : 'and'}</span>
      <Input
        aria-label="Attribute"
        list="flagforge-attributes"
        value={clause.attribute}
        onChange={(e) => onChange({ ...clause, attribute: e.target.value })}
        className="font-mono"
      />
      <datalist id="flagforge-attributes">
        {suggestedAttributes.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <Select aria-label="Operator" value={clause.operator} onChange={(e) => {
        const operator = e.target.value as Operator
        onChange({ ...clause, operator, values: parse(text, operator) })
      }}>
        {Object.entries(operatorLabels).map(([op, label]) => (
          <option key={op} value={op}>
            {label}
          </option>
        ))}
      </Select>
      <Input
        aria-label="Values"
        value={text}
        placeholder={numeric ? '18' : 'IT, FR, ES'}
        onChange={(e) => {
          setText(e.target.value)
          onChange({ ...clause, values: parse(e.target.value, clause.operator) })
        }}
        aria-invalid={clause.values.length === 0}
      />
      <Button variant="ghost" size="sm" aria-label="Remove condition" disabled={!canRemove} onClick={onRemove}>
        <X className="size-4" />
      </Button>
    </div>
  )
}
