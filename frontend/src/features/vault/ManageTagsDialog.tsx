import { useMemo, useState } from 'react'

import { Modal } from '../../components/Modal'
import type { TagSummary } from './tagRegistry'

interface Props {
  tags: TagSummary[]
  busy: boolean
  onClose(): void
  onRename(oldName: string, newName: string): Promise<void>
  onDelete(name: string): Promise<void>
}

export function ManageTagsDialog({ tags, busy, onClose, onRename, onDelete }: Props) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [nextName, setNextName] = useState('')
  const [validation, setValidation] = useState('')
  const visibleTags = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return tags.filter((tag) => !needle || tag.name.toLocaleLowerCase().includes(needle))
  }, [query, tags])

  const beginRename = (name: string) => {
    setEditing(name)
    setNextName(name)
    setValidation('')
  }
  const saveRename = async () => {
    if (!editing) return
    const normalized = nextName.trim()
    if (!normalized) return setValidation('Tag name cannot be empty.')
    if (normalized === editing) return setEditing(null)
    const collision = tags.some((tag) => tag.name === normalized)
    if (collision && !window.confirm(`Merge “${editing}” into the existing “${normalized}” tag?`)) return
    try {
      await onRename(editing, normalized)
      setEditing(null)
      setValidation('')
    } catch {
      setValidation('The tag could not be renamed.')
    }
  }
  const remove = async (tag: TagSummary) => {
    if (!window.confirm(`Remove “${tag.name}” from ${tag.accountCount} account ${tag.accountCount === 1 ? 'entry' : 'entries'}?`)) return
    try {
      await onDelete(tag.name)
    } catch {
      setValidation('The tag could not be deleted.')
    }
  }

  return (
    <Modal title="Manage tags" onClose={() => { if (!busy) onClose() }}>
      <div className="manage-tags">
        <label className="tag-manager-search">Search tags<input autoFocus value={query} placeholder="Search tags" onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="tag-manager-list">
          {visibleTags.map((tag) => editing === tag.name ? (
            <div className="tag-manager-edit" key={tag.name}>
              <input aria-label={`New name for ${tag.name}`} value={nextName} disabled={busy} onChange={(event) => setNextName(event.target.value)} />
              <button type="button" className="button-primary button-small" disabled={busy} onClick={() => void saveRename()}>Save</button>
              <button type="button" className="button-quiet button-small" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
            </div>
          ) : (
            <div className="tag-manager-row" key={tag.name}>
              <span>{tag.name}</span><small>{tag.accountCount} {tag.accountCount === 1 ? 'account' : 'accounts'}</small>
              <button type="button" className="button-quiet button-small" disabled={busy} onClick={() => beginRename(tag.name)}>Rename</button>
              <button type="button" className="button-quiet button-small danger-text" disabled={busy} onClick={() => void remove(tag)}>Delete</button>
            </div>
          ))}
          {!visibleTags.length && <p className="tag-menu-empty">No matching tags.</p>}
        </div>
        {validation && <p className="form-error">{validation}</p>}
        <div className="dialog-actions"><button type="button" className="button-secondary" disabled={busy} onClick={onClose}>Close</button></div>
      </div>
    </Modal>
  )
}
