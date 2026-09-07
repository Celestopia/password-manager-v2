import { useEffect, useMemo, useRef, useState } from 'react'

import { uniqueTags } from './tagRegistry'

interface Props {
  options: string[]
  value: string[]
  onChange(tags: string[]): void
}

export function TagPicker({ options, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const allOptions = useMemo(
    () => uniqueTags([...options, ...value]).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })),
    [options, value],
  )
  const needle = query.trim().toLocaleLowerCase()
  const visibleOptions = allOptions.filter((tag) => !needle || tag.toLocaleLowerCase().includes(needle))
  const newTag = query.trim()
  const canCreate = Boolean(newTag) && !allOptions.includes(newTag)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside)
    return () => window.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const toggle = (tag: string) => {
    onChange(value.includes(tag) ? value.filter((item) => item !== tag) : [...value, tag])
  }

  return (
    <div className="tag-picker" ref={root}>
      <div className="tag-picker-control">
        <button type="button" className="tag-picker-open-area" aria-label="Select tags" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span aria-hidden="true">⌄</span></button>
        <div className="tag-picker-values">
          {value.map((tag) => <span className="tag-chip" key={tag}>{tag}<button type="button" aria-label={`Remove tag ${tag}`} onClick={() => toggle(tag)}>×</button></span>)}
          {!value.length && <span className="tag-picker-placeholder">No tags selected</span>}
        </div>
      </div>
      {open && (
        <div className="tag-picker-popover">
          <input autoFocus aria-label="Search or create a tag" value={query} placeholder="Search or create a tag" onChange={(event) => setQuery(event.target.value)} />
          <div className="tag-picker-options">
            {visibleOptions.map((tag) => <label key={tag}><input type="checkbox" checked={value.includes(tag)} onChange={() => toggle(tag)} /><span>{tag}</span></label>)}
            {canCreate && <button type="button" className="tag-create-option" onClick={() => { onChange(uniqueTags([...value, newTag])); setQuery('') }}>+ Create “{newTag}”</button>}
            {!visibleOptions.length && !canCreate && <p className="tag-menu-empty">No matching tags.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
