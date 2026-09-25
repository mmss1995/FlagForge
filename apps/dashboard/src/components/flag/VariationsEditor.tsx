import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Variation } from '../../lib/api'
import { slugify, type FlagKind } from '../../lib/format'
import { Button, Input } from '../ui'

/** Edits variation ids, names and values. Values are typed according to the flag kind. */
export function VariationsEditor({ kind, variations, onChange }: { kind: FlagKind; variations: Variation[]; onChange(variations: Variation[]): void }) {
  const update = (index: number, patch: Partial<Variation>) => onChange(variations.map((v, i) => (i === index ? { ...v, ...patch } : v)))

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">Variations</legend>
      <div className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 text-xs text-zinc-500">
        <span>Id</span>
        <span>Name</span>
        <span>Value</span>
        <span className="sr-only">Remove</span>
      </div>
      {variations.map((variation, index) => (
        <div key={`${kind}-${index}`} className="grid grid-cols-[1fr_1fr_1.5fr_auto] items-center gap-2">
          <Input aria-label="Variation id" value={variation.id} className="font-mono" onChange={(e) => update(index, { id: e.target.value })} />
          <Input aria-label="Variation name" value={variation.name ?? ''} onChange={(e) => update(index, { name: e.target.value })} />
          <ValueInput kind={kind} value={variation.value} onChange={(value) => update(index, { value })} />
          <Button variant="ghost" size="sm" aria-label="Remove variation" disabled={variations.length <= 1} onClick={() => onChange(variations.filter((_, i) => i !== index))}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      {kind !== 'boolean' && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            const name = `Variant ${variations.length + 1}`
            const value = kind === 'number' ? 0 : kind === 'json' ? {} : name.toLowerCase()
            onChange([...variations, { id: slugify(name), name, value }])
          }}
        >
          <Plus className="size-3.5" /> Add variation
        </Button>
      )}
    </fieldset>
  )
}

function ValueInput({ kind, value, onChange }: { kind: FlagKind; value: Variation['value']; onChange(value: Variation['value']): void }) {
  const [text, setText] = useState(() => (kind === 'json' ? JSON.stringify(value) : String(value)))
  const [invalid, setInvalid] = useState(false)

  if (kind === 'boolean') return <Input aria-label="Variation value" value={String(value)} disabled className="font-mono" />

  return (
    <Input
      aria-label="Variation value"
      aria-invalid={invalid}
      className={`font-mono ${invalid ? 'ring-red-500' : ''}`}
      type={kind === 'number' ? 'number' : 'text'}
      value={text}
      onChange={(e) => {
        const next = e.target.value
        setText(next)
        if (kind === 'string') return onChange(next)
        if (kind === 'number') {
          setInvalid(next === '' || !Number.isFinite(Number(next)))
          if (next !== '' && Number.isFinite(Number(next))) onChange(Number(next))
          return
        }
        try {
          onChange(JSON.parse(next))
          setInvalid(false)
        } catch {
          setInvalid(true)
        }
      }}
    />
  )
}
