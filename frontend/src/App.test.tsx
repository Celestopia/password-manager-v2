import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { resetMockNativeApi } from './api/mock'

describe('App', () => {
  beforeEach(() => resetMockNativeApi())
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('offers open and create actions while the vault is locked', async () => {
    render(<App />)

    expect(await screen.findByRole('button', { name: 'Open a vault' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Password Manager v2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create new vault' })).toBeEnabled()
  })

  it('unlocks a selected vault and reveals a password only on request', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open a vault' }))
    const dialog = await screen.findByRole('dialog', { name: 'Unlock vault' })
    await user.type(screen.getByLabelText('Master password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    await user.click(await screen.findByRole('button', { name: /Example Account/ }))
    expect(await screen.findByText('••••••••••••')).toBeInTheDocument()
    expect(screen.queryByText('demo-password')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    expect(await screen.findByText('demo-password')).toBeInTheDocument()
  })

  it('validates new vault password confirmation before creating', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Create new vault' }))
    await user.type(screen.getByLabelText('Master password'), 'long-enough-password')
    await user.type(screen.getByLabelText('Confirm password'), 'different-password')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('The password entries do not match.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Create vault' })).toBeInTheDocument()
  })

  it('automatically dismisses a success notice after unlocking', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open a vault' }))
    await user.type(screen.getByLabelText('Master password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Vault unlocked.')
    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
