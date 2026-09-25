import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Variation } from '../../lib/api'
import { slugify, type FlagKind } from '../../lib/format'
import { useCreateFlag } from '../../lib/queries'
import { Button, Dialog, ErrorNote, Field, Input, Select, Textarea } from '../ui'
import { VariationsEditor } from './VariationsEditor'

const presets: Record<FlagKind, Variation[]> = {
  boolean: [
    { id: 'on', name: 'On', value: true },
    { id: 'off', name: 'Off', value: false },
  ],
  string: [
    { id: 'control', name: 'Control', value: 'control' },
    { id: 'treatment', name: 'Treatment', value: 'treatment' },
  ],
  number: [
    { id: 'low', name: 'Low', value: 10 },
    { id: 'high', name: 'High', value: 25 },
  ],
  json: [
    { id: 'default', name: 'Default', value: { enabled: false } },
    { id: 'variant', name: 'Variant', value: { enabled: true } },
  ],
}

export function CreateFlagDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const create = useCreateFlag()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [kind, setKind] = useState<FlagKind>('boolean')
  const [variations, setVariations] = useState<Variation[]>(presets.boolean)

  function close() {
    create.reset()
    setName('')
    setKey('')
    setKeyTouched(false)
    setDescription('')
    setTags('')
    setKind('boolean')
    setVariations(presets.boolean)
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const flag = await create.mutateAsync({
      key,
      name,
      description,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      variations,
    })
    close()
    navigate(`/flags/${flag.key}`)
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New flag"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="create-flag" loading={create.isPending} disabled={!name || !key}>
            Create flag
          </Button>
        </>
      }
    >
      <form id="create-flag" onSubmit={submit} className="space-y-4">
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={name}
              autoFocus
              placeholder="New checkout flow"
              onChange={(e) => {
                setName(e.target.value)
                if (!keyTouched) setKey(slugify(e.target.value))
              }}
            />
          )}
        </Field>
        <Field label="Key" hint="Used in code. Cannot be changed later.">
          {(id) => (
            <Input
              id={id}
              value={key}
              className="font-mono"
              pattern="[a-z0-9][a-z0-9._\-]{0,63}"
              onChange={(e) => {
                setKeyTouched(true)
                setKey(e.target.value)
              }}
            />
          )}
        </Field>
        <Field label="Description">{(id) => <Textarea id={id} rows={2} className="font-sans" value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <Field label="Tags" hint="Comma separated, e.g. checkout, release">
          {(id) => <Input id={id} value={tags} onChange={(e) => setTags(e.target.value)} />}
        </Field>
        <Field label="Type" hint="When on, the first variation is served; when off, the last one. Both can be changed per environment.">
          {(id) => (
            <Select
              id={id}
              value={kind}
              onChange={(e) => {
                const next = e.target.value as FlagKind
                setKind(next)
                setVariations(presets[next])
              }}
            >
              <option value="boolean">Boolean</option>
              <option value="string">String</option>
              <option value="number">Number</option>
              <option value="json">JSON</option>
            </Select>
          )}
        </Field>
        {kind !== 'boolean' && <VariationsEditor kind={kind} variations={variations} onChange={setVariations} />}
        <ErrorNote error={create.error} />
      </form>
    </Dialog>
  )
}
