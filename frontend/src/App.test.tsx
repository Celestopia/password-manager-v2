import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { mockNativeApi, resetMockNativeApi } from './api/mock'
import type { RecordDetails, RecordSummary } from './types'

describe('App', () => {
  beforeEach(() => resetMockNativeApi())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
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
    expect(screen.getByText('Choose an account from the list to view its details.')).toBeInTheDocument()
    const recordButton = await screen.findByRole('button', { name: /Example Account/ })
    expect(recordButton.querySelector('.account-avatar')).toBeNull()
    await user.click(recordButton)
    expect(document.querySelector('.large-avatar')).toBeNull()
    expect(screen.queryByText('C:\\Mock\\vault.pmdb')).not.toBeInTheDocument()
    expect(screen.getAllByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)).toHaveLength(2)
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

  it('requires the master password before exporting plaintext', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open a vault' }))
    await user.type(screen.getByLabelText('Master password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await user.click(await screen.findByRole('button', { name: 'Export JSONL' }))

    const dialog = await screen.findByRole('dialog', { name: 'Export plaintext JSONL' })
    expect(dialog).toHaveTextContent('every password and custom-field value in plaintext')
    await user.type(screen.getByLabelText('Master password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Verify and export' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Plaintext export saved to C:\\Mock\\passwords.jsonl')
    expect(dialog).not.toBeInTheDocument()
  })

  it('locks the vault after one failed export reauthentication', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open a vault' }))
    await user.type(screen.getByLabelText('Master password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await user.click(await screen.findByRole('button', { name: 'Export CSV' }))
    await user.type(screen.getByLabelText('Master password'), 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Verify and export' }))

    expect(await screen.findByRole('button', { name: 'Open a vault' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Master password is incorrect. The vault has been locked.')
    expect(screen.queryByRole('dialog', { name: 'Export plaintext CSV' })).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('imports JSONL only through an explicit merge confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open a vault' }))
    await user.type(screen.getByLabelText('Master password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await user.click(await screen.findByRole('button', { name: 'Import JSONL' }))

    expect(confirm).toHaveBeenCalledTimes(2)
    expect(confirm).toHaveBeenNthCalledWith(2, expect.stringContaining('Merge these records'))
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 0 records; skipped 0 identical records.')
  })

  it('cancels JSONL import when merge confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false)
    const importJsonl = vi.spyOn(mockNativeApi, 'import_jsonl')
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open a vault' }))
    await user.type(screen.getByLabelText('Master password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await user.click(await screen.findByRole('button', { name: 'Import JSONL' }))

    expect(importJsonl).not.toHaveBeenCalled()
  })

  it('shows the requested labels and guidance in the password form', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open a vault' }))
    await user.type(screen.getByLabelText('Master password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))
    await user.click(await screen.findByRole('button', { name: '+ Add' }))

    expect(screen.getByLabelText('Creation Date')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('game, finance (use comma to separate tags)')).toBeInTheDocument()
    expect(screen.getByText('Add your custom information.')).toBeInTheDocument()
  })

  it('labels the account search field accurately', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open a vault' }))
    await user.type(screen.getByLabelText('Master password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByPlaceholderText('Search accounts')).toHaveAccessibleName('Search accounts')
  })

  it('sorts and filters account summaries without losing the selected account', async () => {
    const summaries: RecordSummary[] = [
      { id: 'beta', account: 'Beta', username: 'beta-user', phonenumber: '', mail: '', date: '', url: '', tags: [], updated_at: '2026-08-30T00:00:00Z', has_custom_fields: false },
      { id: 'ten', account: 'Account 10', username: 'ten-user', phonenumber: '', mail: '', date: '', url: '', tags: [], updated_at: '2026-08-01T00:00:00Z', has_custom_fields: false },
      { id: 'two', account: 'Account 2', username: 'two-user', phonenumber: '', mail: '', date: '', url: '', tags: [], updated_at: '2026-08-15T00:00:00Z', has_custom_fields: false },
    ]
    vi.spyOn(mockNativeApi, 'list_records').mockResolvedValue({ ok: true, data: summaries })
    vi.spyOn(mockNativeApi, 'get_record_details').mockImplementation(async (recordId) => {
      const summary = summaries.find(({ id }) => id === recordId)!
      const details: RecordDetails = {
        ...summary,
        created_at: summary.updated_at,
        has_password: true,
        custom_fields: [],
      }
      return { ok: true, data: details }
    })
    const listedAccounts = () => Array.from(document.querySelectorAll('.record-card strong'))
      .map((element) => element.textContent)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open a vault' }))
    await user.type(screen.getByLabelText('Master password'), 'correct horse battery staple')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    await screen.findByRole('button', { name: /Beta/ })
    expect(listedAccounts()).toEqual(['Beta', 'Account 10', 'Account 2'])
    await user.click(screen.getByRole('button', { name: /Beta/ }))

    await user.selectOptions(screen.getByLabelText('Sort accounts by'), 'account')
    expect(listedAccounts()).toEqual(['Account 2', 'Account 10', 'Beta'])
    expect(screen.getByRole('button', { name: /Beta/ })).toHaveClass('selected')

    await user.click(screen.getByRole('button', { name: 'Alphabet: A to Z' }))
    expect(listedAccounts()).toEqual(['Beta', 'Account 10', 'Account 2'])

    await user.selectOptions(screen.getByLabelText('Sort accounts by'), 'updated')
    expect(screen.getByRole('button', { name: 'Last modified: newest first' })).toBeInTheDocument()
    expect(listedAccounts()).toEqual(['Beta', 'Account 2', 'Account 10'])

    await user.type(screen.getByLabelText('Search accounts'), 'account')
    expect(listedAccounts()).toEqual(['Account 2', 'Account 10'])
  })
})
