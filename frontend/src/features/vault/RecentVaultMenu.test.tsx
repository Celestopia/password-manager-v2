import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RecentVaultMenu } from './RecentVaultMenu'

afterEach(cleanup)
it('hides history until expanded, opens a selected vault and keeps browse separate', () => {
  const onOpen = vi.fn(), onBrowse = vi.fn()
  render(<RecentVaultMenu paths={['D:\\Vaults\\Personal.pmdb']} onOpen={onOpen} onBrowse={onBrowse} onForget={vi.fn()} />)
  expect(screen.queryByText('Personal.pmdb')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Open a vault' }))
  expect(onBrowse).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Show recent vaults' }))
  fireEvent.click(screen.getByText('Personal.pmdb'))
  expect(onOpen).toHaveBeenCalledWith('D:\\Vaults\\Personal.pmdb')
  expect(screen.queryByText('Personal.pmdb')).not.toBeInTheDocument()
})
it('forgets without opening and closes with Escape or an outside click', () => {
  const onForget = vi.fn(), onOpen = vi.fn()
  render(<RecentVaultMenu paths={['D:\\Vaults\\Personal.pmdb']} onOpen={onOpen} onBrowse={vi.fn()} onForget={onForget} />)
  const trigger = screen.getByRole('button', { name: 'Show recent vaults' })
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: 'Remove Personal.pmdb from recent' }))
  expect(onForget).toHaveBeenCalledWith('D:\\Vaults\\Personal.pmdb')
  expect(onOpen).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  fireEvent.pointerDown(document.body)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})
