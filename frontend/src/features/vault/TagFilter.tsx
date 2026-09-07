import { useEffect, useMemo, useRef, useState } from 'react'

import type { TagSummary } from './tagRegistry'

interface Props {
  tags: TagSummary[]
  selected: string[]
  disabled: boolean
  onChange(tags: string[]): void
}

export function TagFilter({ tags, selected, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const visibleTags = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return tags.filter((tag) => !needle || tag.name.toLocaleLowerCase().includes(needle))
  }, [query, tags])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const toggle = (name: string) => {
    onChange(selected.includes(name) ? selected.filter((tag) => tag !== name) : [...selected, name])
  }
  const label = selected.length === 0 ? 'All tags'
    : selected.length === 1 ? selected[0]
      : `${selected.length} tags selected`

  return (
    <div className="tag-filter" ref={root}>
      <button
        type="button"
        className={`tag-filter-trigger ${selected.length ? 'active' : ''}`}
        aria-label="Filter accounts by tags"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled || tags.length === 0}
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">◇</span><span>{tags.length ? label : 'No tags'}</span><span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="tag-filter-popover" role="dialog" aria-label="Filter accounts by tags">
          <label className="tag-menu-search"><span aria-hidden="true">⌕</span><input autoFocus aria-label="Search tags" value={query} placeholder="Search tags" onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="tag-menu-options">
            {visibleTags.map((tag) => (
              <label className="tag-menu-option" key={tag.name}>
                <input type="checkbox" checked={selected.includes(tag.name)} onChange={() => toggle(tag.name)} />
                <span>{tag.name}</span><small>{tag.accountCount}</small>
              </label>
            ))}
            {!visibleTags.length && <p className="tag-menu-empty">No matching tags.</p>}
          </div>
          <div className="tag-menu-footer">
            <button type="button" className="button-quiet button-small" disabled={!selected.length} onClick={() => onChange([])}>Clear</button>
          </div>
        </div>
      )}
    </div>
  )
}
