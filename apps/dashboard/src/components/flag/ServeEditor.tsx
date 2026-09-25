import type { Serve, Variation } from '../../lib/api'
import { variationLabel } from '../../lib/format'
import { evenWeights, setWeight, totalWeight } from '../../lib/weights'
import { Input, Select } from '../ui'

/** Chooses between serving one variation and splitting traffic by percentage. */
export function ServeEditor({ serve, variations, onChange, label }: { serve: Serve; variations: Variation[]; onChange(serve: Serve): void; label: string }) {
  const value = serve.kind === 'rollout' ? '__rollout' : serve.variationId

  return (
    <div className="space-y-3">
      <Select
        aria-label={label}
        value={value}
        className="sm:w-72"
        onChange={(e) => {
          if (e.target.value === '__rollout') onChange({ kind: 'rollout', weights: evenWeights(variations.map((v) => v.id)) })
          else onChange({ kind: 'variation', variationId: e.target.value })
        }}
      >
        {variations.map((v) => (
          <option key={v.id} value={v.id}>
            Serve “{variationLabel(variations, v.id)}”
          </option>
        ))}
        <option value="__rollout">Percentage rollout…</option>
      </Select>

      {serve.kind === 'rollout' && <RolloutEditor serve={serve} variations={variations} onChange={onChange} />}
    </div>
  )
}

function RolloutEditor({ serve, variations, onChange }: { serve: Extract<Serve, { kind: 'rollout' }>; variations: Variation[]; onChange(serve: Serve): void }) {
  // Variations added after the rollout was configured get a 0% slice.
  const weights = variations.map((v) => serve.weights.find((w) => w.variationId === v.id) ?? { variationId: v.id, weight: 0 })
  const total = totalWeight(weights)

  return (
    <div className="space-y-3 rounded-lg bg-zinc-50 p-4 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden>
        {weights.map((w, i) => (
          <div key={w.variationId} style={{ width: `${w.weight}%` }} className={['bg-forge-500', 'bg-sky-500', 'bg-violet-500', 'bg-emerald-500', 'bg-rose-500'][i % 5]} />
        ))}
      </div>

      {weights.map((w, i) => (
        <div key={w.variationId} className="grid grid-cols-[7rem_1fr_5.5rem] items-center gap-3">
          <span className="truncate text-sm">{variationLabel(variations, w.variationId)}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={w.weight}
            aria-label={`${variationLabel(variations, w.variationId)} percentage`}
            onChange={(e) => onChange({ ...serve, weights: setWeight(weights, i, Number(e.target.value)) })}
            className="accent-forge-600"
          />
          <div className="relative">
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={w.weight}
              aria-label={`${variationLabel(variations, w.variationId)} percentage value`}
              onChange={(e) => onChange({ ...serve, weights: setWeight(weights, i, Number(e.target.value)) })}
              className="pr-7 text-right font-mono"
            />
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-zinc-400">%</span>
          </div>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
        <label className="flex items-center gap-2 whitespace-nowrap text-zinc-500">
          Bucket by
          <Input
            value={serve.bucketBy ?? 'key'}
            onChange={(e) => onChange({ ...serve, bucketBy: e.target.value === 'key' || e.target.value === '' ? undefined : e.target.value })}
            className="w-32 py-1 font-mono"
          />
        </label>
        <span className="text-xs text-zinc-500">Users with the same value always get the same variation.</span>
        {total !== 100 && <span className="ml-auto text-xs font-medium text-red-600">Total {total}% (must be 100%)</span>}
      </div>
    </div>
  )
}
