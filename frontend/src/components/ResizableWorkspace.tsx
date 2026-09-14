import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from 'react'

export const DEFAULT_SIDEBAR_WIDTH = 390
const MIN_WIDTH = 280
const COLLAPSE_THRESHOLD = 180

interface Props {
  width: number
  onWidthChange(width: number): void
  disabled: boolean
  children: ReactNode
}

export function ResizableWorkspace({ width, onWidthChange, disabled, children }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const handle = useRef<HTMLDivElement>(null)
  const restore = useRef<HTMLButtonElement>(null)
  const gesture = useRef<{ pointerId: number; original: number } | null>(null)
  const [maximum, setMaximum] = useState(window.innerWidth / 2)
  const [dragging, setDragging] = useState(false)
  const minimum = Math.min(MIN_WIDTH, maximum)
  const actualWidth = width === 0 ? 0 : Math.min(maximum, Math.max(minimum, width))

  useEffect(() => {
    const measure = () => setMaximum((root.current?.getBoundingClientRect().width || window.innerWidth) / 2)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (root.current) observer?.observe(root.current)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  useEffect(() => {
    const cancel = () => {
      const current = gesture.current
      if (!current) return
      gesture.current = null
      setDragging(false)
      onWidthChange(current.original)
      if (handle.current?.hasPointerCapture(current.pointerId)) handle.current.releasePointerCapture(current.pointerId)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); cancel() }
    }
    window.addEventListener('keydown', escape)
    window.addEventListener('blur', cancel)
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel) }
  }, [onWidthChange])

  const finish = (cancel: boolean) => {
    const current = gesture.current
    if (!current) return
    gesture.current = null
    setDragging(false)
    if (cancel) onWidthChange(current.original)
    else if (width === 0) restore.current?.focus()
    if (handle.current?.hasPointerCapture(current.pointerId)) handle.current.releasePointerCapture(current.pointerId)
  }
  const move = (event: PointerEvent) => {
    if (gesture.current?.pointerId !== event.pointerId) return
    if (disabled) { finish(true); return }
    const proposed = event.clientX - (root.current?.getBoundingClientRect().left ?? 0)
    onWidthChange(proposed < COLLAPSE_THRESHOLD ? 0 : Math.max(minimum, Math.min(maximum, proposed)))
  }
  const keyboard = (event: KeyboardEvent) => {
    if (disabled || gesture.current) return
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'End' ? maximum : actualWidth + (event.key === 'ArrowLeft' ? -20 : 20)
    if (event.key === 'Home' || event.key === 'Enter' || next < minimum) {
      onWidthChange(0)
      requestAnimationFrame(() => restore.current?.focus())
    } else onWidthChange(Math.min(maximum, next))
  }

  return <div ref={root} className={`workspace${width === 0 ? ' sidebar-collapsed' : ''}${dragging ? ' sidebar-resizing' : ''}`}
    style={{ '--sidebar-width': `${actualWidth}px` } as CSSProperties}>
    {children}
    <div ref={handle} className="sidebar-divider" role="separator" aria-label="Resize account list"
      aria-orientation="vertical" aria-valuemin={0} aria-valuemax={Math.round(maximum)} aria-valuenow={Math.round(actualWidth)}
      aria-controls="account-sidebar" aria-disabled={disabled} tabIndex={disabled || width === 0 ? -1 : 0}
      title="Drag to resize; drag near the left edge to collapse. Arrow keys resize; Home or Enter collapses."
      onKeyDown={keyboard}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || event.isPrimary === false) return
        event.preventDefault()
        event.currentTarget.focus()
        gesture.current = { pointerId: event.pointerId, original: actualWidth }
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={move} onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)} />
    {width === 0 && <button ref={restore} className="sidebar-restore" aria-label="Expand account list" disabled={disabled}
      title="Expand account list" onClick={() => {
        onWidthChange(Math.min(DEFAULT_SIDEBAR_WIDTH, maximum))
        requestAnimationFrame(() => handle.current?.focus())
      }}>›</button>}
  </div>
}
