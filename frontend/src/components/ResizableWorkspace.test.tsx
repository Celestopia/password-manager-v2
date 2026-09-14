import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_SIDEBAR_WIDTH, ResizableWorkspace } from './ResizableWorkspace'

function Harness({ disabled = false }) {
  const [width, setWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  return <ResizableWorkspace width={width} onWidthChange={setWidth} disabled={disabled}>
    <aside>Accounts</aside><section>Details</section>
  </ResizableWorkspace>
}
let windowWidth = 1200
beforeEach(() => {
  windowWidth = 1200
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: windowWidth, left: 0, right: windowWidth, top: 0, bottom: 700, height: 700, x: 0, y: 0, toJSON: () => ({}),
  }))
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false)
  HTMLElement.prototype.releasePointerCapture = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const divider = () => screen.getByRole('separator')
function drag(x: number) {
  fireEvent.pointerDown(divider(), { button: 0, clientX: 390 })
  fireEvent.pointerMove(divider(), { clientX: x })
}
it('resizes within bounds and responds to window size changes', () => {
  render(<Harness />)
  drag(900)
  expect(divider()).toHaveAttribute('aria-valuenow', '600')
  fireEvent.pointerMove(divider(), { clientX: 220 })
  expect(divider()).toHaveAttribute('aria-valuenow', '280')
  fireEvent.pointerMove(divider(), { clientX: 550 })
  fireEvent.pointerUp(divider())
  windowWidth = 960
  act(() => { window.dispatchEvent(new Event('resize')) })
  expect(divider()).toHaveAttribute('aria-valuenow', '480')
})
it('collapses immediately and restores the default instead of the previous width', () => {
  render(<Harness />)
  drag(500)
  fireEvent.pointerUp(divider())
  drag(179)
  expect(divider()).toHaveAttribute('aria-valuenow', '0')
  expect(screen.getByRole('button', { name: 'Expand account list' })).toBeInTheDocument()
  fireEvent.pointerUp(divider())
  fireEvent.click(screen.getByRole('button', { name: 'Expand account list' }))
  expect(divider()).toHaveAttribute('aria-valuenow', '390')
})
it.each(['escape', 'blur', 'cancel', 'capture'])('cancels a drag on %s', (cause) => {
  render(<Harness />)
  drag(170)
  if (cause === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
  if (cause === 'blur') fireEvent.blur(window)
  if (cause === 'cancel') fireEvent.pointerCancel(divider())
  if (cause === 'capture') fireEvent.lostPointerCapture(divider())
  expect(divider()).toHaveAttribute('aria-valuenow', '390')
})
it('supports keyboard resizing and starts at the default on remount', () => {
  const view = render(<Harness />)
  fireEvent.keyDown(divider(), { key: 'ArrowRight' })
  expect(divider()).toHaveAttribute('aria-valuenow', '410')
  fireEvent.keyDown(divider(), { key: 'End' })
  expect(divider()).toHaveAttribute('aria-valuenow', '600')
  fireEvent.keyDown(divider(), { key: 'Home' })
  expect(divider()).toHaveAttribute('aria-valuenow', '0')
  view.unmount()
  render(<Harness />)
  expect(divider()).toHaveAttribute('aria-valuenow', '390')
})
it('prevents resizing when disabled', () => {
  render(<Harness disabled />)
  drag(500)
  fireEvent.keyDown(divider(), { key: 'Home' })
  expect(divider()).toHaveAttribute('aria-valuenow', '390')
})
