import { useState } from 'react'
import { formatValue } from '../lib/format'
import { CopyButton, cx } from './ui'

type Framework = 'react' | 'vue' | 'js'

function snippet(framework: Framework, flagKey: string, defaultValue: unknown): string {
  const fallback = defaultValue === undefined ? 'false' : typeof defaultValue === 'string' ? `'${defaultValue}'` : formatValue(defaultValue)
  switch (framework) {
    case 'react':
      return `import { useFlag } from '@flagforge/react'

const value = useFlag('${flagKey}', ${fallback})`
    case 'vue':
      return `import { useFlag } from '@flagforge/vue'

const value = useFlag('${flagKey}', ${fallback}) // Ref`
    case 'js':
      return `import { createClient } from '@flagforge/js'

const client = createClient({ baseUrl, sdkKey, context: { key: userId } })
await client.ready()
const value = client.variation('${flagKey}', ${fallback})`
  }
}

export function CodeSnippet({ flagKey, defaultValue }: { flagKey: string; defaultValue?: unknown }) {
  const [framework, setFramework] = useState<Framework>('react')
  const code = snippet(framework, flagKey, defaultValue)

  return (
    <div className="overflow-hidden rounded-xl bg-zinc-900 text-zinc-100 ring-1 ring-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-800 px-2">
        <div className="flex" role="tablist">
          {(['react', 'vue', 'js'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={framework === f}
              onClick={() => setFramework(f)}
              className={cx('px-3 py-2 text-xs font-medium capitalize', framework === f ? 'text-white shadow-[inset_0_-2px] shadow-forge-500' : 'text-zinc-400 hover:text-zinc-200')}
            >
              {f === 'js' ? 'Vanilla JS' : f}
            </button>
          ))}
        </div>
        <CopyButton value={code} label="Copy snippet" />
      </div>
      <pre className="p-4 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
    </div>
  )
}
