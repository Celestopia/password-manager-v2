import { useState, type FormEvent } from 'react'

import { Modal } from '../../components/Modal'

interface Props {
  busy: boolean
  onClose(): void
  onSubmit(current: string, next: string): Promise<void>
}

export function PasswordDialog({ busy, onClose, onSubmit }: Props) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [validation, setValidation] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!current) return setValidation('Enter the current master password.')
    if (next.length < 12) return setValidation('Use at least 12 characters for the new password.')
    if (next !== confirmation) return setValidation('The new password entries do not match.')
    setValidation('')
    await onSubmit(current, next)
  }

  return (
    <Modal title="Change master password" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label>Current password<input autoFocus type="password" autoComplete="off" value={current} onChange={(event) => setCurrent(event.target.value)} /></label>
        <label>New password<input type="password" autoComplete="off" value={next} onChange={(event) => setNext(event.target.value)} /></label>
        <label>Confirm new password<input type="password" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        {validation && <p className="form-error">{validation}</p>}
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button-primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
        </div>
      </form>
    </Modal>
  )
}
