import { useState, type FormEvent } from 'react'

import { Modal } from '../../components/Modal'

interface Props {
  mode: 'unlock' | 'create'
  path: string
  busy: boolean
  onClose(): void
  onSubmit(values: { password: string; overwrite: boolean; memoryMiB: number }): Promise<void>
}

export function VaultDialog({ mode, path, busy, onClose, onSubmit }: Props) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [memoryMiB, setMemoryMiB] = useState(64)
  const [validation, setValidation] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password) return setValidation('Master password is required.')
    if (mode === 'create' && password.length < 12) return setValidation('Use at least 12 characters.')
    if (mode === 'create' && password !== confirmation) return setValidation('The password entries do not match.')
    setValidation('')
    await onSubmit({ password, overwrite, memoryMiB })
  }

  return (
    <Modal title={mode === 'unlock' ? 'Unlock vault' : 'Create vault'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label>Vault<input value={path} readOnly /></label>
        <label>Master password<input autoFocus type="password" value={password} autoComplete="off" spellCheck={false} onChange={(event) => setPassword(event.target.value)} /></label>
        {mode === 'create' && <>
          <label>Confirm password<input type="password" value={confirmation} autoComplete="off" spellCheck={false} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <label>Argon2 memory cost<select value={memoryMiB} onChange={(event) => setMemoryMiB(Number(event.target.value))}><option value={64}>64 MiB</option><option value={128}>128 MiB</option><option value={256}>256 MiB</option></select></label>
          <label className="checkbox-row"><input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />Overwrite an existing vault and keep its previous version as .bak</label>
        </>}
        {validation && <p className="form-error">{validation}</p>}
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button-primary" disabled={busy}>{busy ? 'Working…' : mode === 'unlock' ? 'Unlock' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  )
}
