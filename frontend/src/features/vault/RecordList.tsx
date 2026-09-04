import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'

import type { MovePlacement, RecordSummary } from '../../types'

type Target = { id: string; placement: MovePlacement }
type Gesture = {
  id: string
  mode: 'pointer' | 'keyboard'
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  active: boolean
  index: number
  target: Target | null
}
type Preview = { id: string; target: Target | null } | null

interface Props {
  records: RecordSummary[]
  selectedId: string | null
  disabledReason: string | null
  emptyMessage: string
  onSelect: (id: string) => void
  onMove: (id: string, targetId: string, placement: MovePlacement) => Promise<void>
  onActiveChange: (active: boolean) => void
}

function insertionIndex(records: RecordSummary[], id: string, target: Target): number {
  const remaining = records.filter((record) => record.id !== id)
  return remaining.findIndex((record) => record.id === target.id) + (target.placement === 'after' ? 1 : 0)
}

export function RecordList({ records, selectedId, disabledReason, emptyMessage, onSelect, onMove, onActiveChange }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const frame = useRef<number | null>(null)
  const pending = useRef(false)
  const focusAfterSave = useRef<string | null>(null)
  const [preview, setPreview] = useState<Preview>(null)
  const [saving, setSaving] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const instructionsId = useId()
  const help = disabledReason ?? 'Drag to reorder. Or press Space to pick up, use arrow keys, and press Space to save. Escape cancels.'

  useEffect(() => {
    if (saving || disabledReason || focusAfterSave.current === null) return
    const id = focusAfterSave.current
    focusAfterSave.current = null
    if (document.activeElement === document.body) {
      const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-record-id]') ?? [])
        .find((element) => element.dataset.recordId === id)
      row?.querySelector<HTMLButtonElement>('.drag-handle')?.focus()
    }
  }, [saving, disabledReason])

  const reset = useCallback(() => {
    gesture.current = null
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    setPreview(null)
    onActiveChange(false)
  }, [onActiveChange])

  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault()
        reset()
        setAnnouncement('Reorder cancelled.')
      }
    }
    const blur = () => {
      if (gesture.current) {
        reset()
        setAnnouncement('Reorder cancelled.')
      }
    }
    window.addEventListener('keydown', cancel)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', cancel)
      window.removeEventListener('blur', blur)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [reset])

  const publish = (current: Gesture) => {
    setPreview((previous) => previous?.id === current.id
      && previous.target?.id === current.target?.id
      && previous.target?.placement === current.target?.placement
      ? previous : { id: current.id, target: current.target })
  }

  const targetAtPointer = (current: Gesture): Target | null => {
    const list = listRef.current
    if (!list) return null
    const bounds = list.getBoundingClientRect()
    if (current.x < bounds.left || current.x > bounds.right || current.y < bounds.top || current.y > bounds.bottom) return null
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-record-id]'))
      .filter((row) => row.dataset.recordId !== current.id)
    for (const row of rows) {
      const rect = row.getBoundingClientRect()
      if (current.y < rect.top + rect.height / 2) return { id: row.dataset.recordId!, placement: 'before' }
    }
    const last = rows.at(-1)
    return last ? { id: last.dataset.recordId!, placement: 'after' } : null
  }

  const trackPointer = () => {
    const current = gesture.current
    if (!current || current.mode !== 'pointer') return
    if (current.active) {
      const list = listRef.current
      if (list) {
        const bounds = list.getBoundingClientRect()
        if (current.x >= bounds.left && current.x <= bounds.right && current.y >= bounds.top && current.y <= bounds.bottom) {
          const edge = Math.min(40, bounds.height / 4)
          const top = current.y - bounds.top
          const bottom = bounds.bottom - current.y
          const speed = top < edge ? -12 * (1 - top / edge) : bottom < edge ? 12 * (1 - bottom / edge) : 0
          list.scrollTop += speed
        }
      }
      current.target = targetAtPointer(current)
      publish(current)
    }
    frame.current = requestAnimationFrame(trackPointer)
  }

  const startPointer = (event: PointerEvent<HTMLButtonElement>, id: string) => {
    if (disabledReason || pending.current || gesture.current || event.button !== 0 || event.isPrimary === false) return
    event.preventDefault()
    event.currentTarget.focus()
    gesture.current = {
      id, mode: 'pointer', pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      active: false, index: records.findIndex((record) => record.id === id), target: null,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    frame.current = requestAnimationFrame(trackPointer)
  }

  const movePointer = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current
    if (!current || current.mode !== 'pointer' || current.pointerId !== event.pointerId) return
    if (disabledReason) { reset(); return }
    current.x = event.clientX
    current.y = event.clientY
    if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
      current.active = true
      onActiveChange(true)
      setAnnouncement('Entry picked up. Drop at the insertion line to save, or press Escape to cancel.')
    }
    if (current.active) {
      current.target = targetAtPointer(current)
      publish(current)
    }
  }

  const commit = async () => {
    const current = gesture.current
    reset()
    if (!current?.active || !current.target || disabledReason || pending.current) return
    const index = insertionIndex(records, current.id, current.target)
    if (index === records.findIndex((record) => record.id === current.id)) {
      setAnnouncement('Order unchanged.')
      return
    }
    pending.current = true
    focusAfterSave.current = current.mode === 'keyboard' ? current.id : null
    setSaving(true)
    setAnnouncement('Saving entry order.')
    try {
      await onMove(current.id, current.target.id, current.target.placement)
      setAnnouncement('Entry order saved. Position ' + (index + 1) + ' of ' + records.length + '.')
    } catch {
      setAnnouncement('Order was not saved. The previous order has been restored.')
    } finally {
      pending.current = false
      setSaving(false)
    }
  }

  const endPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const current = gesture.current
    if (current?.mode !== 'pointer' || current.pointerId !== event.pointerId) return
    current.x = event.clientX
    current.y = event.clientY
    current.target = targetAtPointer(current)
    void commit()
  }

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (disabledReason || pending.current) return
    const current = gesture.current
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (event.repeat) return
      if (current?.mode === 'keyboard' && current.id === id) { void commit(); return }
      if (current) return
      gesture.current = {
        id, mode: 'keyboard', pointerId: -1, startX: 0, startY: 0, x: 0, y: 0,
        active: true, index: records.findIndex((record) => record.id === id), target: null,
      }
      onActiveChange(true)
      publish(gesture.current)
      setAnnouncement('Entry picked up. Use arrow keys to move, Space to save, or Escape to cancel.')
      return
    }
    if (current?.mode !== 'keyboard' || current.id !== id || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const original = records.findIndex((record) => record.id === id)
    current.index = event.key === 'Home' ? 0 : event.key === 'End' ? records.length - 1
      : Math.max(0, Math.min(records.length - 1, current.index + (event.key === 'ArrowUp' ? -1 : 1)))
    current.target = current.index === original ? null : {
      id: records[current.index].id, placement: current.index < original ? 'before' : 'after',
    }
    publish(current)
    const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-record-id]') ?? [])
      .find((element) => element.dataset.recordId === records[current.index].id)
    row?.scrollIntoView({ block: 'nearest' })
    setAnnouncement('Position ' + (current.index + 1) + ' of ' + records.length + '. Press Space to save.')
  }

  return <>
    <p id={instructionsId} className="sr-only">{help}</p>
    <div className="sr-only" aria-label="Reorder announcements" aria-live="polite" aria-atomic="true">{announcement}</div>
    <div className="record-list" ref={listRef} aria-label="Account entries" aria-busy={saving}>
      {records.map((record) => {
        const marker = preview?.target?.id === record.id ? ' drop-' + preview.target.placement : ''
        return <div key={record.id} data-record-id={record.id} className={'record-row' + marker + (preview?.id === record.id ? ' is-dragging' : '')}>
          <span className="drag-handle-wrapper" title={help}>
            <button
              type="button" className="drag-handle" aria-label={'Reorder ' + record.account}
              aria-describedby={instructionsId} aria-pressed={preview?.id === record.id}
              disabled={Boolean(disabledReason) || saving}
              onPointerDown={(event) => startPointer(event, record.id)}
              onPointerMove={movePointer} onPointerUp={endPointer}
              onPointerCancel={reset} onLostPointerCapture={() => { if (gesture.current?.mode === 'pointer') reset() }}
              onKeyDown={(event) => keyDown(event, record.id)}
              onBlur={() => { if (gesture.current?.mode === 'keyboard') { reset(); setAnnouncement('Reorder cancelled.') } }}
            ><span aria-hidden="true">⠿</span></button>
          </span>
          <button type="button" className={'record-card ' + (selectedId === record.id ? 'selected' : '')}
            disabled={saving} onClick={() => { if (!gesture.current?.active) onSelect(record.id) }}>
            <span className="record-card-copy"><strong>{record.account}</strong><small>{record.username || record.mail || 'No username'}</small>
              <span className="tag-line">{record.tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}</span>
            </span><span className="chevron">›</span>
          </button>
        </div>
      })}
      {records.length === 0 && <div className="empty-list"><span>◇</span><p>{emptyMessage}</p></div>}
    </div>
  </>
}
