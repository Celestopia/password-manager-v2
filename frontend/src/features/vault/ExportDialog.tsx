import { useState, type FormEvent } from 'react'

import { Modal } from '../../components/Modal'

interface Props {
  busy: boolean
  format: 'jsonl' | 'csv'
  onClose(): void
  onSubmit(masterPassword: string): Promise<void>
}

export function ExportDialog({ busy, format, onClose, onSubmit }: Props) {
  const [masterPassword, setMasterPassword] = useState('')
  const [validation, setValidation] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!masterPassword) return setValidation('Enter the master password.')
    setValidation('')
    await onSubmit(masterPassword)
  }

  return (
    <Modal title={`Export plaintext ${format.toUpperCase()}`} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <p className="muted">This export contains every password and custom-field value in plaintext. Re-enter the master password to continue.</p>
        <label>Master password<input autoFocus type="password" autoComplete="off" spellCheck={false} value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} /></label>
        {validation && <p className="form-error">{validation}</p>}
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button-primary" disabled={busy}>{busy ? 'Verifying…' : 'Verify and export'}</button>
        </div>
      </form>
    </Modal>
  )
}
