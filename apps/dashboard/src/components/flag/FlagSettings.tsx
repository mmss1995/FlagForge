import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Flag, Variation } from '../../lib/api'
import { flagKind } from '../../lib/format'
import { useDeleteFlag, useUpdateFlag } from '../../lib/queries'
import { Button, Card, Dialog, ErrorNote, Field, Input, Textarea } from '../ui'
import { VariationsEditor } from './VariationsEditor'

export function FlagSettings({ flag }: { flag: Flag }) {
  const update = useUpdateFlag(flag.key)
  const remove = useDeleteFlag()
  const navigate = useNavigate()
  const [name, setName] = useState(flag.name)
  const [description, setDescription] = useState(flag.description)
  const [tags, setTags] = useState(flag.tags.join(', '))
  const [variations, setVariations] = useState<Variation[]>(flag.variations)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const parsedTags = tags.split(',').map((t) => t.trim()).filter(Boolean)
  const dirty =
    name !== flag.name || description !== flag.description || parsedTags.join() !== flag.tags.join() || JSON.stringify(variations) !== JSON.stringify(flag.variations)

  return (
    <div className="space-y-4">
      <Card title="Details">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            update.mutate({ name, description, tags: parsedTags, variations, expectedUpdatedAt: flag.updatedAt })
          }}
        >
          <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Description">{(id) => <Textarea id={id} rows={2} className="font-sans" value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
          <Field label="Tags" hint="Comma separated">
            {(id) => <Input id={id} value={tags} onChange={(e) => setTags(e.target.value)} />}
          </Field>
          <VariationsEditor kind={flagKind(flag.variations)} variations={variations} onChange={setVariations} />
          <ErrorNote error={update.error} />
          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={!dirty} loading={update.isPending}>
              Save details
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Lifecycle" description="Archived flags disappear from SDKs, which then serve their code defaults. Delete is only possible once archived.">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => update.mutate({ archived: !flag.archived })} loading={update.isPending}>
            {flag.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            {flag.archived ? 'Restore flag' : 'Archive flag'}
          </Button>
          {flag.archived && (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-4" /> Delete permanently
            </Button>
          )}
        </div>
      </Card>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete “${flag.name}”?`}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={async () => {
                await remove.mutateAsync(flag.key)
                navigate('/flags')
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This removes <code>{flag.key}</code> and cannot be undone. Make sure no code still reads it. The audit history is kept.
        </p>
        <ErrorNote error={remove.error} />
      </Dialog>
    </div>
  )
}
