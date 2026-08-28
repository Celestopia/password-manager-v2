import { useState, type FormEvent } from 'react'

import { Modal } from '../../components/Modal'
import type { CustomField, RecordDetails, RecordInput } from '../../types'

interface Props {
  mode: 'add' | 'edit'
  initial?: RecordDetails
  customFields?: CustomField[]
  busy: boolean
  onClose(): void
  onSubmit(values: RecordInput): Promise<void>
}

const blank = {
  account: '', username: '', phonenumber: '', mail: '', date: '', url: '', tags: [] as string[],
}

export function RecordDialog({ mode, initial, customFields = [], busy, onClose, onSubmit }: Props) {
  const seed = initial ?? blank
  const [account, setAccount] = useState(seed.account)
  const [username, setUsername] = useState(seed.username)
  const [password, setPassword] = useState('')
  const [phonenumber, setPhonenumber] = useState(seed.phonenumber)
  const [mail, setMail] = useState(seed.mail)
  const [date, setDate] = useState(seed.date)
  const [url, setUrl] = useState(seed.url)
  const [tags, setTags] = useState(seed.tags.join(', '))
  const [fields, setFields] = useState<CustomField[]>(customFields)
  const [validation, setValidation] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!account.trim()) return setValidation('Account is required.')
    if (mode === 'add' && !password) return setValidation('Password is required for a new record.')
    const normalizedFields = fields.filter((field) => field.key.trim() || field.value)
    if (normalizedFields.some((field) => !field.key.trim())) return setValidation('Every custom field needs a name.')
    const keys = normalizedFields.map((field) => field.key.trim())
    if (new Set(keys).size !== keys.length) return setValidation('Custom field names must be unique.')
    setValidation('')
    const values: RecordInput = {
      account: account.trim(), username, phonenumber, mail, date, url,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      custom_fields: normalizedFields.map((field) => ({ key: field.key.trim(), value: field.value })),
    }
    if (mode === 'add') values.password = password
    if (mode === 'edit' && password) values.password_change = password
    await onSubmit(values)
  }

  const updateField = (index: number, key: keyof CustomField, value: string) => {
    setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, [key]: value } : field))
  }

  return (
    <Modal title={mode === 'add' ? 'Add password' : 'Edit password'} onClose={onClose} wide>
      <form className="form-stack" onSubmit={submit}>
        <div className="form-grid">
          <label>Account<input autoFocus value={account} onChange={(event) => setAccount(event.target.value)} /></label>
          <label>Username<input value={username} autoComplete="off" onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="span-two">{mode === 'add' ? 'Password' : 'New password (leave blank to keep current)'}<input type="password" value={password} autoComplete="new-password" spellCheck={false} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Email<input type="email" value={mail} onChange={(event) => setMail(event.target.value)} /></label>
          <label>Phone number<input value={phonenumber} onChange={(event) => setPhonenumber(event.target.value)} /></label>
          <label>Creation Date<input value={date} placeholder="YYYY-MM-DD or a note" onChange={(event) => setDate(event.target.value)} /></label>
          <label>Website<input type="url" value={url} placeholder="https://example.com" onChange={(event) => setUrl(event.target.value)} /></label>
          <label className="span-two">Tags<input value={tags} placeholder="game, finance (use comma to separate tags)" onChange={(event) => setTags(event.target.value)} /></label>
        </div>
        <div className="custom-fields-heading">
          <div><h3>Custom fields</h3><p>Add your custom information.</p></div>
          <button type="button" className="button-secondary button-small" onClick={() => setFields((current) => [...current, { key: '', value: '' }])}>Add field</button>
        </div>
        {fields.map((field, index) => (
          <div className="custom-field-row" key={index}>
            <input aria-label={`Custom field ${index + 1} name`} placeholder="Field name" value={field.key} onChange={(event) => updateField(index, 'key', event.target.value)} />
            <input aria-label={`Custom field ${index + 1} value`} placeholder="Value" value={field.value} onChange={(event) => updateField(index, 'value', event.target.value)} />
            <button type="button" className="icon-button danger" aria-label={`Remove custom field ${index + 1}`} onClick={() => setFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index))}>×</button>
          </div>
        ))}
        {validation && <p className="form-error">{validation}</p>}
        <div className="dialog-actions">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="button-primary" disabled={busy}>{busy ? 'Saving…' : mode === 'add' ? 'Add password' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  )
}
