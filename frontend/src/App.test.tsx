import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  it('creates an empty password and preserves blank-edit semantics before and after adding a password', async () => {
    const user = userEvent.setup()
    await mockNativeApi.unlock_vault('mock', 'password')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: '+ Add' }))
    expect(screen.getByRole('dialog', { name: 'Add account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Password', { exact: true })).toHaveValue('')
    await user.type(screen.getByLabelText('Description'), 'Line one{enter}背景信息')
    await user.type(screen.getByLabelText('Account'), 'Passwordless')
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    expect(await screen.findByText('No password')).toBeInTheDocument()
    expect(screen.getByText('Account entry')).toBeInTheDocument()
    expect(document.querySelector('.description-card')).toHaveTextContent('Line one 背景信息')
    expect(screen.getByRole('status')).toHaveTextContent('Account entry added.')
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('dialog', { name: 'Edit account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toHaveValue('Line one\n背景信息')
    await user.clear(screen.getByLabelText('Description'))
    await user.click(await screen.findByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('No password')).toBeInTheDocument()
    expect(document.querySelector('.description-card')).toHaveTextContent('—')
    expect(screen.getByRole('status')).toHaveTextContent('Account entry updated.')
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.type(await screen.findByLabelText('New password (leave blank to keep current)'), 'later secret')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByRole('button', { name: 'Reveal' })
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.click(await screen.findByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    expect(await screen.findByText('later secret')).toBeInTheDocument()
  })

  it('uses account wording in the empty vault and deletion notice', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await mockNativeApi.unlock_vault('mock', 'password')
    render(<App />)
    await user.click(await screen.findByRole('button', { name: /^Example Account/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('heading', { name: 'Add your first account' })).toBeInTheDocument()
    expect(screen.getByText('Add an account to this encrypted vault.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Account entry deleted.')
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    expect(screen.getByRole('dialog', { name: 'Add account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Password', { exact: true })).toBeInTheDocument()
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
    const recordButton = await screen.findByRole('button', { name: /^Example Account/ })
    expect(recordButton.querySelector('.account-avatar')).toBeNull()
    await user.click(recordButton)
    expect(document.querySelector('.large-avatar')).toBeNull()
    expect(document.querySelectorAll('.identity-card dl > div')).toHaveLength(5)
    expect(document.querySelector('.description-card button')).toBeNull()
    expect(screen.queryByText('C:\\Mock\\vault.pmdb')).not.toBeInTheDocument()
    expect(screen.getAllByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)).toHaveLength(2)
    expect(await screen.findByText('••••••••••••')).toBeInTheDocument()
    expect(screen.queryByText('demo-password')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal' }))
    expect(await screen.findByText('demo-password')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Password copied.')
    expect(screen.getByRole('status')).not.toHaveTextContent('cleared')
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

    expect(await screen.findByRole('status')).toHaveTextContent('Plaintext export saved to C:\\Mock\\accounts.jsonl')
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
    expect(confirm).toHaveBeenNthCalledWith(2, expect.stringContaining('Merge these account entries'))
    expect(await screen.findByRole('status')).toHaveTextContent('Imported 0 account entries; skipped 0 identical account entries.')
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
    expect(screen.getByLabelText('Description')).toHaveAttribute('rows', '2')
    expect(screen.getByRole('button', { name: 'Select tags' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Select tags' }))
    expect(screen.getByPlaceholderText('Search or create a tag')).toBeInTheDocument()
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

  it('enables reordering only in default ascending order with no search or open dialog', async () => {
    await mockNativeApi.unlock_vault('mock', 'password')
    const user = userEvent.setup()
    render(<App />)
    const handle = await screen.findByRole('button', { name: 'Reorder Example Account' })
    expect(handle).toBeEnabled()
    const sort = screen.getByLabelText('Sort accounts by')
    for (const field of ['account', 'entry_created', 'entry_updated']) {
      await user.selectOptions(sort, field)
      expect(handle).toBeDisabled()
    }
    await user.selectOptions(sort, 'vault')
    await user.click(screen.getByRole('button', { name: 'Default: first to last' }))
    expect(handle).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Default: last to first' }))
    await user.type(screen.getByLabelText('Search accounts'), ' ')
    expect(handle).toBeDisabled()
    await user.clear(screen.getByLabelText('Search accounts'))
    expect(handle).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '+ Add' }))
    expect(handle).toBeDisabled()
  })

  it('filters accounts by all selected tags in a floating menu and disables reordering', async () => {
    await mockNativeApi.unlock_vault('mock', 'password')
    await mockNativeApi.add_record({
      account: 'Shared work', username: '', phonenumber: '', mail: '', date: '', url: '',
      tags: ['demo', 'work'], description: '', custom_fields: [], password: '',
    })
    await mockNativeApi.add_record({
      account: 'Work only', username: '', phonenumber: '', mail: '', date: '', url: '',
      tags: ['work'], description: '', custom_fields: [], password: '',
    })
    const listedAccounts = () => Array.from(document.querySelectorAll('.record-card strong')).map((item) => item.textContent)
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: /^Example Account/ }))
    const filter = screen.getByRole('button', { name: 'Filter accounts by tags' })
    await user.click(filter)
    const menu = screen.getByRole('dialog', { name: 'Filter accounts by tags' })
    expect(menu).toHaveClass('tag-filter-popover')
    await user.click(screen.getByRole('checkbox', { name: /demo/ }))
    expect(listedAccounts()).toEqual(['Example Account', 'Shared work'])
    await user.click(screen.getByRole('checkbox', { name: /work/ }))
    expect(listedAccounts()).toEqual(['Shared work'])
    expect(screen.getByRole('heading', { name: 'Example Account' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reorder Shared work' })).toBeDisabled()
    expect(filter).toHaveTextContent('2 tags selected')
  })

  it('creates selectable tags and manages derived registry names across accounts', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await mockNativeApi.unlock_vault('mock', 'password')
    const rename = vi.spyOn(mockNativeApi, 'rename_tag')
    const remove = vi.spyOn(mockNativeApi, 'delete_tag')
    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByRole('button', { name: '+ Add' }))
    await user.type(screen.getByLabelText('Account'), 'Tagged account')
    await user.click(screen.getByRole('button', { name: 'Select tags' }))
    const tagSearch = screen.getByLabelText('Search or create a tag')
    await user.type(tagSearch, 'new tag')
    await user.click(screen.getByRole('button', { name: '+ Create “new tag”' }))
    expect(screen.getByRole('button', { name: 'Remove tag new tag' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add account' }))
    await screen.findByRole('heading', { name: 'Tagged account' })

    await user.click(screen.getByRole('button', { name: 'Manage tags' }))
    const dialog = screen.getByRole('dialog', { name: 'Manage tags' })
    const newTagRow = within(dialog).getByText('new tag').closest('.tag-manager-row')!
    await user.click(newTagRow.querySelector<HTMLButtonElement>('button')!)
    const renameInput = screen.getByLabelText('New name for new tag')
    await user.clear(renameInput)
    await user.type(renameInput, 'renamed')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(rename).toHaveBeenCalledWith('new tag', 'renamed'))
    expect(dialog).toHaveTextContent('renamed')

    const renamedRow = within(dialog).getByText('renamed').closest('.tag-manager-row')!
    await user.click(Array.from(renamedRow.querySelectorAll('button')).find((button) => button.textContent === 'Delete')!)
    await waitFor(() => expect(remove).toHaveBeenCalledWith('renamed'))
    expect(dialog).not.toHaveTextContent('renamed')
  })

  it.each([false, true])('keeps selection and confirmed order through a keyboard move (failure=%s)', async (fail) => {
    HTMLElement.prototype.scrollIntoView = vi.fn()
    await mockNativeApi.unlock_vault('mock', 'password')
    await mockNativeApi.add_record({
      account: 'Second', username: '', phonenumber: '', mail: '', date: '', url: '', tags: [],
      description: '', custom_fields: [], password: 'synthetic',
    })
    const move = vi.spyOn(mockNativeApi, 'move_record')
    if (fail) move.mockResolvedValue({ ok: false, error: { code: 'IO_ERROR', message: 'Simulated save failure.' } })
    const user = userEvent.setup()
    render(<App />)
    const handle = await screen.findByRole('button', { name: 'Reorder Example Account' })
    await user.click(screen.getByRole('button', { name: /^Example Account/ }))
    fireEvent.keyDown(handle, { key: ' ' })
    expect(screen.getByLabelText('Sort accounts by')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Lock vault' })).toBeDisabled()
    fireEvent.keyDown(handle, { key: 'End' })
    fireEvent.keyDown(handle, { key: ' ' })
    await waitFor(() => expect(move).toHaveBeenCalledTimes(1))
    if (fail) expect(await screen.findByRole('alert')).toHaveTextContent('Simulated save failure.')
    else await screen.findByText(/Entry order saved/)
    expect(Array.from(document.querySelectorAll('.record-card strong')).map((item) => item.textContent))
      .toEqual(fail ? ['Example Account', 'Second'] : ['Second', 'Example Account'])
    expect(screen.getByRole('button', { name: /^Example Account/ })).toHaveClass('selected')
    expect(screen.getByRole('heading', { name: 'Example Account' })).toBeInTheDocument()
  })

  it('sorts and filters account summaries without losing the selected account', async () => {
    const summaries: RecordSummary[] = [
      { id: 'beta', account: 'Beta', username: 'beta-user', phonenumber: '', mail: '', date: '', url: '', tags: [], created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-30T00:00:00Z', has_custom_fields: false },
      { id: 'ten', account: 'Account 10', username: 'ten-user', phonenumber: '', mail: '', date: '', url: '', tags: [], created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-01T00:00:00Z', has_custom_fields: false },
      { id: 'two', account: 'Account 2', username: 'two-user', phonenumber: '', mail: '', date: '', url: '', tags: [], created_at: '2026-08-10T00:00:00Z', updated_at: '2026-08-15T00:00:00Z', has_custom_fields: false },
    ]
    vi.spyOn(mockNativeApi, 'list_records').mockResolvedValue({ ok: true, data: summaries })
    vi.spyOn(mockNativeApi, 'get_record_details').mockImplementation(async (recordId) => {
      const summary = summaries.find(({ id }) => id === recordId)!
      const details: RecordDetails = {
        ...summary,
        description: summary.id === 'beta' ? 'Search must ignore account keyword here.' : '',
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

    await screen.findByRole('button', { name: /^Beta/ })
    expect(listedAccounts()).toEqual(['Beta', 'Account 10', 'Account 2'])
    await user.click(screen.getByRole('button', { name: /^Beta/ }))
    await waitFor(() => expect(Array.from(document.querySelectorAll('.metadata-card > div > span'))
      .map((element) => element.textContent)).toEqual(['Tags', 'Created', 'Updated']))

    await user.selectOptions(screen.getByLabelText('Sort accounts by'), 'account')
    expect(listedAccounts()).toEqual(['Account 2', 'Account 10', 'Beta'])
    expect(screen.getByRole('button', { name: /^Beta/ })).toHaveClass('selected')

    await user.click(screen.getByRole('button', { name: 'Alphabet: A to Z' }))
    expect(listedAccounts()).toEqual(['Beta', 'Account 10', 'Account 2'])

    const sortSelect = screen.getByLabelText('Sort accounts by')
    expect(Array.from(sortSelect.querySelectorAll('option')).map((option) => option.textContent)).toEqual([
      'alphabet',
      'default',
      'entry_updated',
      'entry_created',
    ])

    await user.selectOptions(sortSelect, 'entry_updated')
    expect(screen.getByRole('button', { name: 'Entry updated: newest first' })).toBeInTheDocument()
    expect(listedAccounts()).toEqual(['Beta', 'Account 2', 'Account 10'])

    await user.selectOptions(sortSelect, 'entry_created')
    expect(screen.getByRole('button', { name: 'Entry created: newest first' })).toBeInTheDocument()
    expect(listedAccounts()).toEqual(['Account 10', 'Account 2', 'Beta'])

    await user.type(screen.getByLabelText('Search accounts'), 'account')
    expect(listedAccounts()).toEqual(['Account 10', 'Account 2'])
  })
})
