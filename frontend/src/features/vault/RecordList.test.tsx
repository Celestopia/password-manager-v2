import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordSummary } from '../../types'
import { RecordList } from './RecordList'

const records: RecordSummary[] = ['Alpha', 'Beta', 'Gamma'].map((account) => ({
  id: account, account, username: '', phonenumber: '', mail: '', date: '', url: '',
  tags: [], created_at: '', updated_at: '', has_custom_fields: false,
}))
let tick: FrameRequestCallback

function setup(disabledReason: string | null = null, onMove = vi.fn().mockResolvedValue(undefined)) {
  const onSelect = vi.fn()
  const onActiveChange = vi.fn()
  render(<RecordList records={records} selectedId="Beta" disabledReason={disabledReason} emptyMessage="Empty"
    onSelect={onSelect} onMove={onMove} onActiveChange={onActiveChange} />)
  return { onSelect, onMove, onActiveChange, handle: screen.getByRole('button', { name: 'Reorder Alpha' }) }
}

function pointer(handle: HTMLElement, y: number, x = 15) {
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 15, clientY: 50 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: x, clientY: y })
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.recordId
      ? 10 + records.findIndex((record) => record.id === this.dataset.recordId) * 100
        - (document.querySelector('.record-list')?.scrollTop ?? 0) : 0
    return { top, bottom: top + (this.dataset.recordId ? 100 : 350), left: 0, right: 300,
      width: 300, height: this.dataset.recordId ? 100 : 350, x: 0, y: top, toJSON: () => ({}) }
  })
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.scrollIntoView = vi.fn()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { tick = callback; return 1 })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RecordList reordering', () => {
  it('separates selection from the drag handle and ignores small movements', () => {
    const { handle, onMove, onSelect } = setup()
    fireEvent.click(screen.getByRole('button', { name: /^Alpha/ }))
    expect(onSelect).toHaveBeenCalledWith('Alpha')
    pointer(handle, 53)
    fireEvent.pointerUp(handle, { clientX: 15, clientY: 53 })
    expect(onMove).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('previews a pointer drop and saves exactly once after release', async () => {
    const { handle, onMove } = setup()
    pointer(handle, 290)
    expect(document.querySelector('.drop-after')).toHaveAttribute('data-record-id', 'Gamma')
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.pointerUp(handle, { clientX: 15, clientY: 290 })
    fireEvent.pointerUp(handle, { clientX: 15, clientY: 290 })
    await waitFor(() => expect(onMove).toHaveBeenCalledExactlyOnceWith('Alpha', 'Gamma', 'after'))
    expect(await screen.findByText(/Entry order saved/)).toBeInTheDocument()
  })

  it.each(['escape', 'outside', 'cancel', 'lost capture', 'blur', 'no-op'])('does not save a %s drop', (action) => {
    const { handle, onMove } = setup()
    pointer(handle, action === 'no-op' ? 100 : 290)
    if (action === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
    if (action === 'cancel') fireEvent.pointerCancel(handle)
    if (action === 'lost capture') fireEvent.lostPointerCapture(handle)
    if (action === 'blur') fireEvent(window, new Event('blur'))
    fireEvent.pointerUp(handle, { clientX: action === 'outside' ? 400 : 15, clientY: action === 'no-op' ? 100 : 290 })
    expect(onMove).not.toHaveBeenCalled()
    expect(document.querySelector('.drop-after')).toBeNull()
  })

  it('scrolls near the edge while the pointer is held still', () => {
    const { handle } = setup()
    pointer(handle, 345)
    const list = screen.getByLabelText('Account entries')
    act(() => tick(0))
    expect(list.scrollTop).toBeGreaterThan(0)
    fireEvent.pointerCancel(handle)
  })

  it('supports keyboard pickup, movement, and confirmation', async () => {
    const { handle, onMove } = setup()
    fireEvent.keyDown(handle, { key: ' ' })
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(screen.getByLabelText('Reorder announcements')).toHaveTextContent('Position 2 of 3')
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.keyDown(handle, { key: 'Enter' })
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('Alpha', 'Beta', 'after'))
  })

  it('cancels keyboard changes with Escape or focus loss', () => {
    const { handle, onMove } = setup()
    fireEvent.keyDown(handle, { key: ' ' })
    fireEvent.keyDown(handle, { key: 'End' })
    fireEvent.keyDown(handle, { key: 'Escape' })
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.keyDown(handle, { key: ' ' })
    fireEvent.keyDown(handle, { key: 'End' })
    fireEvent.blur(handle)
    expect(document.querySelector('.drop-after')).toBeNull()
    expect(onMove).not.toHaveBeenCalled()
  })

  it('disables handles with a reason but leaves normal selection available', () => {
    const { handle, onMove, onSelect } = setup('Choose default order and clear search.')
    expect(handle).toBeDisabled()
    expect(handle).toHaveAccessibleDescription('Choose default order and clear search.')
    pointer(handle, 290)
    fireEvent.keyDown(handle, { key: ' ' })
    expect(onMove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Beta/ }))
    expect(onSelect).toHaveBeenCalledWith('Beta')
  })

  it('blocks duplicate moves until the save finishes', async () => {
    let complete!: () => void
    const onMove = vi.fn(() => new Promise<void>((resolve) => { complete = resolve }))
    const { handle } = setup(null, onMove)
    fireEvent.keyDown(handle, { key: ' ' })
    fireEvent.keyDown(handle, { key: 'End' })
    fireEvent.keyDown(handle, { key: ' ' })
    expect(handle).toBeDisabled()
    fireEvent.keyDown(handle, { key: ' ' })
    expect(onMove).toHaveBeenCalledTimes(1)
    await act(async () => complete())
    expect(handle).toBeEnabled()
  })

  it('clears the preview and retains confirmed order on failure', async () => {
    const { handle } = setup(null, vi.fn().mockRejectedValue(new Error('Save failed')))
    pointer(handle, 290)
    fireEvent.pointerUp(handle, { clientX: 15, clientY: 290 })
    await screen.findByText(/Order was not saved/)
    expect(document.querySelector('.drop-after')).toBeNull()
    expect(Array.from(document.querySelectorAll('.record-card strong')).map((item) => item.textContent))
      .toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(screen.getByRole('button', { name: /^Beta/ })).toHaveClass('selected')
  })
})
