import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from './api/client'
import { ExportDialog } from './features/vault/ExportDialog'
import { ManageTagsDialog } from './features/vault/ManageTagsDialog'
import { PasswordDialog } from './features/vault/PasswordDialog'
import { RecordDialog } from './features/vault/RecordDialog'
import { RecordList } from './features/vault/RecordList'
import { filterAndSortRecords, sortDirectionLabel } from './features/vault/recordSorting'
import type { RecordSortField, SortDirection } from './features/vault/recordSorting'
import { TagFilter } from './features/vault/TagFilter'
import { buildTagRegistry } from './features/vault/tagRegistry'
import { VaultDialog } from './features/vault/VaultDialog'
import { externalWebsiteUrl } from './features/vault/websiteUrl'
import type { CustomField, MovePlacement, RecordDetails, RecordInput, RecordSummary, VaultStatus } from './types'

type VaultDialogState = { mode: 'unlock' | 'create'; path: string }
type RecordDialogState = { mode: 'add' } | { mode: 'edit'; initial: RecordDetails; customFields: CustomField[] }

const MESSAGE_DISMISS_DELAY_MS = 5_000

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.'
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) return value
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}:${pad(parsed.getSeconds())}`
}

export function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [records, setRecords] = useState<RecordSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [details, setDetails] = useState<RecordDetails | null>(null)
  const [query, setQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [sortField, setSortField] = useState<RecordSortField>('vault')
  const [sortDirection, setSortDirection] = useState<SortDirection>('ascending')
  const [busy, setBusy] = useState(false)
  const [reordering, setReordering] = useState(false)
  const movePending = useRef(false)
  const [error, setError] = useState('')
  const [errorRevision, setErrorRevision] = useState(0)
  const [notice, setNotice] = useState('')
  const [noticeRevision, setNoticeRevision] = useState(0)
  const [vaultDialog, setVaultDialog] = useState<VaultDialogState | null>(null)
  const [recordDialog, setRecordDialog] = useState<RecordDialogState | null>(null)
  const [manageTags, setManageTags] = useState(false)
  const [passwordDialog, setPasswordDialog] = useState(false)
  const [exportDialog, setExportDialog] = useState<'jsonl' | 'csv' | null>(null)
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null)
  const [revealedFields, setRevealedFields] = useState<CustomField[] | null>(null)

  const showError = (caught: unknown) => {
    setError(errorMessage(caught))
    setErrorRevision((current) => current + 1)
    setNotice('')
  }

  const showNotice = (message: string) => {
    setNotice(message)
    setNoticeRevision((current) => current + 1)
    setError('')
  }

  const refreshRecords = async (preferredId?: string | null) => {
    const [nextRecords, nextStatus] = await Promise.all([api.list(''), api.status()])
    setRecords(nextRecords)
    const availableTags = new Set(buildTagRegistry(nextRecords).map((tag) => tag.name))
    setSelectedTags((current) => current.filter((tag) => availableTags.has(tag)))
    setStatus(nextStatus)
    const candidate = preferredId === undefined ? selectedId : preferredId
    if (candidate && nextRecords.some((record) => record.id === candidate)) {
      setSelectedId(candidate)
      setDetails(await api.details(candidate))
    } else {
      setSelectedId(null)
      setDetails(null)
    }
  }

  useEffect(() => {
    let active = true
    api.status()
      .then(async (initialStatus) => {
        if (!active) return
        setStatus(initialStatus)
        if (initialStatus.unlocked) {
          const initialRecords = await api.list('')
          if (active) setRecords(initialRecords)
        }
      })
      .catch((caught: unknown) => active && showError(caught))
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (revealedPassword === null) return
    const timeout = window.setTimeout(() => setRevealedPassword(null), 10_000)
    return () => window.clearTimeout(timeout)
  }, [revealedPassword])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(''), MESSAGE_DISMISS_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [notice, noticeRevision])

  useEffect(() => {
    if (!error) return
    const timeout = window.setTimeout(() => setError(''), MESSAGE_DISMISS_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [error, errorRevision])

  const tagRegistry = useMemo(() => buildTagRegistry(records), [records])
  const tagNames = useMemo(() => tagRegistry.map((tag) => tag.name), [tagRegistry])
  const visibleRecords = useMemo(
    () => filterAndSortRecords(records, query, sortField, sortDirection, selectedTags),
    [query, records, selectedTags, sortDirection, sortField],
  )

  const directionLabel = sortDirectionLabel(sortField, sortDirection)
  const websiteUrl = details ? externalWebsiteUrl(details.url) : null
  const reorderDisabledReason = busy ? 'Wait for the current operation to finish.'
    : recordDialog || passwordDialog || exportDialog || manageTags ? 'Close the dialog before reordering.'
    : sortField !== 'vault' || sortDirection !== 'ascending' || query.length > 0 || selectedTags.length > 0
      ? 'To reorder, select default sorting with the upward arrow and clear the search and tag filters.'
      : null

  const moveRecord = async (id: string, targetId: string, placement: MovePlacement) => {
    if (movePending.current || reorderDisabledReason) throw new Error('Reordering is unavailable.')
    movePending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await api.moveRecord(id, targetId, placement)
      setRecords(result.records)
    } catch (caught) {
      showError(caught)
      throw caught
    } finally {
      movePending.current = false
      setBusy(false)
    }
  }

  const chooseVault = async (mode: 'unlock' | 'create') => {
    setError('')
    try {
      const result = mode === 'unlock' ? await api.chooseVault() : await api.chooseNewVault()
      if (result.path) setVaultDialog({ mode, path: result.path })
    } catch (caught) {
      showError(caught)
    }
  }

  const submitVault = async (values: { password: string; overwrite: boolean; memoryMiB: number }) => {
    if (!vaultDialog) return
    setBusy(true)
    setError('')
    try {
      const nextStatus = vaultDialog.mode === 'unlock'
        ? await api.unlock(vaultDialog.path, values.password)
        : await api.create(vaultDialog.path, values.password, values.overwrite, values.memoryMiB)
      setStatus(nextStatus)
      setVaultDialog(null)
      setSelectedTags([])
      setRecords(await api.list(''))
      showNotice(vaultDialog.mode === 'unlock' ? 'Vault unlocked.' : 'Vault created and unlocked.')
    } catch (caught) {
      showError(caught)
    } finally {
      setBusy(false)
    }
  }

  const lockVault = async () => {
    setBusy(true)
    try {
      setStatus(await api.lock())
      setRecords([])
      setSelectedId(null)
      setDetails(null)
      setQuery('')
      setSelectedTags([])
      setManageTags(false)
      setRevealedPassword(null)
      setRevealedFields(null)
      setExportDialog(null)
      showNotice('Vault locked and secrets cleared from the session.')
    } catch (caught) {
      showError(caught)
    } finally {
      setBusy(false)
    }
  }

  const selectRecord = async (recordId: string) => {
    setSelectedId(recordId)
    setRevealedPassword(null)
    setRevealedFields(null)
    setError('')
    try {
      setDetails(await api.details(recordId))
    } catch (caught) {
      showError(caught)
    }
  }

  const saveRecord = async (values: RecordInput) => {
    setBusy(true)
    setError('')
    try {
      const saved = recordDialog?.mode === 'edit'
        ? await api.updateRecord(recordDialog.initial.id, values)
        : await api.addRecord(values)
      setRecordDialog(null)
      setRevealedPassword(null)
      setRevealedFields(null)
      await refreshRecords(saved.id)
      showNotice(recordDialog?.mode === 'edit' ? 'Account entry updated.' : 'Account entry added.')
    } catch (caught) {
      showError(caught)
    } finally {
      setBusy(false)
    }
  }

  const editRecord = async () => {
    if (!details) return
    setBusy(true)
    setError('')
    try {
      const customFields = details.has_custom_fields ? await api.revealCustomFields(details.id) : []
      setRevealedFields(null)
      setRevealedPassword(null)
      setRecordDialog({ mode: 'edit', initial: details, customFields })
    } catch (caught) {
      showError(caught)
    } finally {
      setBusy(false)
    }
  }

  const deleteRecord = async () => {
    if (!details || !window.confirm(`Delete “${details.account}”? This cannot be undone.`)) return
    setBusy(true)
    try {
      await api.deleteRecord(details.id)
      await refreshRecords(null)
      showNotice('Account entry deleted.')
    } catch (caught) {
      showError(caught)
    } finally {
      setBusy(false)
    }
  }

  const renameTag = async (oldName: string, newName: string) => {
    setBusy(true)
    setError('')
    try {
      const result = await api.renameTag(oldName, newName)
      setRecords(result.records)
      setSelectedTags((current) => Array.from(new Set(current.map((tag) => tag === oldName ? newName : tag))))
      setDetails((current) => {
        if (!current) return current
        const summary = result.records.find((record) => record.id === current.id)
        return summary ? { ...current, ...summary } : current
      })
      showNotice(result.changed ? `Tag “${oldName}” renamed.` : 'No account entries required an update.')
    } catch (caught) {
      showError(caught)
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const deleteTag = async (name: string) => {
    setBusy(true)
    setError('')
    try {
      const result = await api.deleteTag(name)
      setRecords(result.records)
      setSelectedTags((current) => current.filter((tag) => tag !== name))
      setDetails((current) => {
        if (!current) return current
        const summary = result.records.find((record) => record.id === current.id)
        return summary ? { ...current, ...summary } : current
      })
      showNotice(result.changed ? `Tag “${name}” removed from all account entries.` : 'No account entries required an update.')
    } catch (caught) {
      showError(caught)
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const revealPassword = async () => {
    if (!details) return
    try {
      setRevealedPassword((await api.revealPassword(details.id)).password)
    } catch (caught) {
      showError(caught)
    }
  }

  const copyPassword = async () => {
    if (!details) return
    try {
      await api.copyPassword(details.id)
      showNotice('Password copied.')
    } catch (caught) {
      showError(caught)
    }
  }

  const revealCustomFields = async () => {
    if (!details) return
    try {
      setRevealedFields(await api.revealCustomFields(details.id))
    } catch (caught) {
      showError(caught)
    }
  }

  const importRecords = async () => {
    setBusy(true)
    try {
      const choice = await api.chooseImport()
      if (!choice.path) return
      if (!window.confirm('Import this plaintext JSONL file into the unlocked vault?')) return
      if (!window.confirm('Merge these account entries into the current vault? Identical account entries will be skipped; conflicting account entries will cancel the entire import.')) return
      const result = await api.importJsonl(choice.path)
      await refreshRecords(null)
      showNotice(`Imported ${result.imported_count} account entr${result.imported_count === 1 ? 'y' : 'ies'}; skipped ${result.skipped_count} identical account entr${result.skipped_count === 1 ? 'y' : 'ies'}.`)
    } catch (caught) {
      showError(caught)
    } finally {
      setBusy(false)
    }
  }

  const exportRecords = async (masterPassword: string) => {
    if (!exportDialog) return
    const format = exportDialog
    setBusy(true)
    setError('')
    try {
      await api.authorizeExport(masterPassword)
      setExportDialog(null)
      const choice = await api.chooseExport(format)
      if (!choice.path) return
      const result = await api.exportRecords(choice.path, format)
      showNotice(`Plaintext export saved to ${result.path}`)
    } catch (caught) {
      try {
        const nextStatus = await api.status()
        if (!nextStatus.unlocked) {
          setStatus(nextStatus)
          setRecords([])
          setSelectedId(null)
          setDetails(null)
          setQuery('')
          setRevealedPassword(null)
          setRevealedFields(null)
          setExportDialog(null)
        }
      } catch {
        // Preserve the original export error if the follow-up status check fails.
      }
      showError(caught)
    } finally {
      setBusy(false)
    }
  }

  const changePassword = async (current: string, next: string) => {
    setBusy(true)
    try {
      await api.changePassword(current, next)
      setPasswordDialog(false)
      showNotice('Master password changed. A backup of the previous vault was retained.')
    } catch (caught) {
      showError(caught)
    } finally {
      setBusy(false)
    }
  }

  if (status === null) {
    return <main className="loading-screen"><div className="brand-mark" aria-hidden="true">◆</div><h1>Password Manager v2</h1><p>Starting secure desktop session…</p></main>
  }

  if (!status.unlocked) {
    return (
      <main className="welcome-screen">
        <section className="welcome-card">
          <div className="brand-mark" aria-hidden="true">◆</div>
          <p className="eyebrow">Offline. Encrypted. Yours.</p>
          <h1>Password Manager v2</h1>
          <p className="welcome-copy">Keep credentials in a local vault protected with Argon2id and authenticated encryption.</p>
          {error && <div className="banner banner-error" role="alert">{error}</div>}
          {notice && <div className="banner banner-success" role="status">{notice}</div>}
          <div className="welcome-actions">
            <button className="button-primary" onClick={() => void chooseVault('unlock')}>Open a vault</button>
            <button className="button-secondary" onClick={() => void chooseVault('create')}>Create new vault</button>
          </div>
          <p className="security-note">Your master password is never stored on disk.</p>
        </section>
        {vaultDialog && <VaultDialog {...vaultDialog} busy={busy} onClose={() => setVaultDialog(null)} onSubmit={submitVault} />}
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-symbol">◆</span><strong>Password Manager v2</strong></div>
        <div className="topbar-actions">
          <button className="button-quiet" onClick={() => setPasswordDialog(true)} disabled={busy || reordering}>Change master password</button>
          <button className="button-secondary" onClick={() => void lockVault()} disabled={busy || reordering}>Lock vault</button>
        </div>
      </header>
      {(error || notice) && <div className={`banner app-banner ${error ? 'banner-error' : 'banner-success'}`} role={error ? 'alert' : 'status'}><span>{error || notice}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => { setError(''); setNotice('') }}>×</button></div>}
      <div className="workspace">
        <aside className="records-pane">
          <div className="records-toolbar">
            <label className="search-box"><span aria-hidden="true">⌕</span><input aria-label="Search accounts" value={query} placeholder="Search accounts" disabled={busy || reordering} onChange={(event) => setQuery(event.target.value)} /></label>
            <button className="button-primary add-button" onClick={() => setRecordDialog({ mode: 'add' })} disabled={busy || reordering}>+ Add</button>
          </div>
          <TagFilter tags={tagRegistry} selected={selectedTags} disabled={busy || reordering} onChange={setSelectedTags} />
          <div className="records-caption">
            <span>{visibleRecords.length} of {records.length} entries</span>
            <div className="sort-controls">
              <span>Sort:</span>
              <select
                className="sort-select"
                aria-label="Sort accounts by"
                disabled={busy || reordering}
                value={sortField}
                onChange={(event) => setSortField(event.target.value as RecordSortField)}
              >
                <option value="account">alphabet</option>
                <option value="vault">default</option>
                <option value="entry_updated">entry_updated</option>
                <option value="entry_created">entry_created</option>
              </select>
              <button
                type="button"
                className="sort-direction-button"
                disabled={busy || reordering}
                aria-label={directionLabel}
                title={directionLabel}
                onClick={() => setSortDirection((current) => current === 'ascending' ? 'descending' : 'ascending')}
              >
                {sortDirection === 'ascending' ? '↑' : '↓'}
              </button>
            </div>
          </div>
          <RecordList records={visibleRecords} selectedId={selectedId} disabledReason={reorderDisabledReason}
            emptyMessage={records.length ? 'No entries match your filters.' : 'Your vault is empty.'}
            onSelect={(id) => void selectRecord(id)} onMove={moveRecord} onActiveChange={setReordering} />
          <div className="records-footer">
            <div className="file-action-group import-actions"><span>Import:</span><button className="button-quiet" aria-label="Import JSONL" onClick={() => void importRecords()} disabled={busy || reordering}>JSONL</button></div>
            <div className="file-action-group export-actions"><span>Export:</span><button className="button-quiet" aria-label="Export JSONL" onClick={() => setExportDialog('jsonl')} disabled={busy || reordering}>JSONL</button><button className="button-quiet" aria-label="Export CSV" onClick={() => setExportDialog('csv')} disabled={busy || reordering}>CSV</button></div>
            <button type="button" className="button-quiet manage-tags-button" onClick={() => setManageTags(true)} disabled={busy || reordering}>Manage tags</button>
          </div>
        </aside>
        <section className="detail-pane">
          {!details ? <div className="empty-detail"><div className="empty-vault-icon">◇</div><h2>{records.length ? 'Select an entry' : 'Add your first account'}</h2><p>{records.length ? 'Choose an account from the list to view its details.' : 'Add an account to this encrypted vault.'}</p>{!records.length && <button className="button-primary" onClick={() => setRecordDialog({ mode: 'add' })}>Add account</button>}</div> : <>
            <div className="detail-heading"><div className="detail-title"><p className="eyebrow">Account entry</p><h1>{details.account}</h1><p>{details.username || details.mail || 'No username'}</p></div><div className="detail-actions"><button className="button-secondary" onClick={() => void editRecord()} disabled={busy || reordering}>Edit</button><button className="button-danger" onClick={() => void deleteRecord()} disabled={busy || reordering}>Delete</button></div></div>
            <div className="detail-grid">
              <article className="detail-card secret-card"><div className="field-heading"><span>Password</span>{details.has_password && <button className="button-quiet" onClick={() => revealedPassword === null ? void revealPassword() : setRevealedPassword(null)}>{revealedPassword === null ? 'Reveal' : 'Hide'}</button>}</div><div className="secret-row"><code>{details.has_password ? revealedPassword ?? '••••••••••••' : 'No password'}</code>{details.has_password && <button className="button-primary button-small" onClick={() => void copyPassword()}>Copy</button>}</div></article>
              <article className="detail-card identity-card"><dl><div><dt>Username</dt><dd>{details.username || '—'}</dd></div><div><dt>Email</dt><dd>{details.mail || '—'}</dd></div><div><dt>Phone</dt><dd>{details.phonenumber || '—'}</dd></div><div><dt>Date</dt><dd>{details.date || '—'}</dd></div><div><dt>Website</dt><dd>{details.url ? websiteUrl ? <a href={websiteUrl} target="_blank" rel="noopener noreferrer">{details.url}</a> : details.url : '—'}</dd></div></dl></article>
              <article className="detail-card custom-fields-card"><div className="field-heading"><span>Custom fields</span>{details.has_custom_fields && <button className="button-quiet" onClick={() => revealedFields === null ? void revealCustomFields() : setRevealedFields(null)}>{revealedFields === null ? 'Reveal values' : 'Hide values'}</button>}</div>{details.custom_fields.length ? <dl>{details.custom_fields.map((field, index) => <div key={`${field.key}-${index}`}><dt>{field.key}</dt><dd>{revealedFields?.[index]?.value ?? (field.has_value ? '••••••••' : '—')}</dd></div>)}</dl> : <p className="muted">No custom fields.</p>}</article>
              <article className="detail-card description-card"><div className="field-heading"><span>Description</span></div><p>{details.description || '—'}</p></article>
              <article className="detail-card metadata-card"><div><span>Tags</span><p className="tag-line">{details.tags.length ? details.tags.map((tag) => <em key={tag}>{tag}</em>) : '—'}</p></div><div><span>Created</span><p>{formatDate(details.created_at)}</p></div><div><span>Updated</span><p>{formatDate(details.updated_at)}</p></div></article>
            </div>
          </>}
        </section>
      </div>
      {recordDialog && <RecordDialog {...recordDialog} availableTags={tagNames} busy={busy} onClose={() => setRecordDialog(null)} onSubmit={saveRecord} />}
      {manageTags && <ManageTagsDialog tags={tagRegistry} busy={busy} onClose={() => setManageTags(false)} onRename={renameTag} onDelete={deleteTag} />}
      {passwordDialog && <PasswordDialog busy={busy} onClose={() => setPasswordDialog(false)} onSubmit={changePassword} />}
      {exportDialog && <ExportDialog format={exportDialog} busy={busy} onClose={() => { if (!busy) setExportDialog(null) }} onSubmit={exportRecords} />}
    </div>
  )
}
