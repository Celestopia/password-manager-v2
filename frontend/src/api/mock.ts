import type { ApiResponse, CustomField, NativeApi, RecordDetails, RecordSummary, VaultStatus } from '../types'

type MockRecord = RecordSummary & { password: string; custom_fields: CustomField[] }
let unlocked = false
let masterPassword = 'correct horse battery staple'
let exportAuthorized = false
const demoRecords = (): MockRecord[] => [{ id: 'demo-record', account: 'Example Account', username: 'demo@example.com', password: 'demo-password', phonenumber: '', mail: 'demo@example.com', date: '2026-08', url: 'https://example.com', tags: ['demo'], custom_fields: [{ key: 'Recovery code', value: 'example-only' }], has_custom_fields: true, created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:00Z' }]
let records = demoRecords()
const ok = <T,>(data: T): ApiResponse<T> => ({ ok: true, data })
const failure = (code: string, message: string): ApiResponse<never> => ({ ok: false, error: { code, message } })
const status = (): VaultStatus => ({ unlocked, vault_path: unlocked ? 'C:\\Mock\\vault.pmdb' : null, record_count: unlocked ? records.length : 0 })
const summary = (record: MockRecord): RecordSummary => ({
  id: record.id,
  account: record.account,
  username: record.username,
  phonenumber: record.phonenumber,
  mail: record.mail,
  date: record.date,
  url: record.url,
  tags: record.tags,
  created_at: record.created_at,
  updated_at: record.updated_at,
  has_custom_fields: record.has_custom_fields,
})

export const mockNativeApi: NativeApi = {
  async move_record(recordId, targetId, placement) {
    if (!unlocked) return failure('SESSION_STATE_INVALID', 'No vault is unlocked.')
    if (placement !== 'before' && placement !== 'after') return failure('INVALID_ARGUMENT', 'Invalid placement.')
    const record = records.find((item) => item.id === recordId)
    const target = records.find((item) => item.id === targetId)
    if (!record || !target) return failure('RECORD_NOT_FOUND', 'Record not found.')
    const previous = records.map((item) => item.id)
    if (record !== target) {
      records.splice(records.indexOf(record), 1)
      records.splice(records.indexOf(target) + (placement === 'after' ? 1 : 0), 0, record)
    }
    return ok({ changed: records.some((item, index) => item.id !== previous[index]), records: records.map(summary) })
  },
  async get_status() { return ok(status()) },
  async choose_vault() { return ok({ path: 'C:\\Mock\\vault.pmdb' }) },
  async choose_new_vault_path() { return ok({ path: 'C:\\Mock\\new-vault.pmdb' }) },
  async choose_import_file() { return ok({ path: 'C:\\Mock\\import.jsonl' }) },
  async choose_export_file(format) { if (!exportAuthorized) return failure('PERMISSION_DENIED', 'Plaintext export requires fresh master-password authorization.'); return ok({ path: `C:\\Mock\\passwords.${format}` }) },
  async authorize_export(password) { exportAuthorized = false; if (password !== masterPassword) { unlocked = false; return failure('VAULT_AUTHENTICATION_FAILED', 'Master password is incorrect. The vault has been locked.') } exportAuthorized = true; return ok({ authorized: true }) },
  async unlock_vault(_path, password) { unlocked = true; masterPassword = password; return ok(status()) },
  async create_vault(_path, password) { unlocked = true; masterPassword = password; records = []; return ok(status()) },
  async lock_vault() { unlocked = false; exportAuthorized = false; return ok(status()) },
  async list_records(query) { const needle = query.toLocaleLowerCase(); return ok(records.filter((record) => record.account.toLocaleLowerCase().includes(needle)).map(summary)) },
  async get_record_details(recordId) { const record = records.find((item) => item.id === recordId)!; const details: RecordDetails = { ...summary(record), has_password: Boolean(record.password), custom_fields: record.custom_fields.map((field) => ({ key: field.key, has_value: Boolean(field.value) })) }; return ok(details) },
  async reveal_password(recordId) { return ok({ password: records.find((item) => item.id === recordId)!.password }) },
  async copy_password() { return ok({ clear_after_seconds: 30 }) },
  async reveal_custom_fields(recordId) { return ok(records.find((item) => item.id === recordId)!.custom_fields) },
  async add_record(values) { const now = new Date().toISOString(); const record: MockRecord = { ...values, password: values.password ?? '', id: crypto.randomUUID(), created_at: now, updated_at: now, has_custom_fields: values.custom_fields.length > 0 }; records.push(record); return ok(summary(record)) },
  async update_record(recordId, values) { const record = records.find((item) => item.id === recordId)!; Object.assign(record, values); if (values.password_change !== undefined) record.password = values.password_change; record.has_custom_fields = record.custom_fields.length > 0; record.updated_at = new Date().toISOString(); return ok(summary(record)) },
  async delete_record(recordId) { const index = records.findIndex((item) => item.id === recordId); const [record] = records.splice(index, 1); return ok(summary(record)) },
  async import_jsonl() { return ok({ imported_count: 0, skipped_count: 0 }) },
  async export_records(path, format) { if (!exportAuthorized) return failure('PERMISSION_DENIED', 'Plaintext export requires fresh master-password authorization.'); exportAuthorized = false; return ok({ path, format }) },
  async change_master_password() { return ok({ changed: true }) },
  async get_header_info() { return ok({ version: 1, format: 'jsonl', cipher: { name: 'chacha20-poly1305' } }) },
}

export function resetMockNativeApi() {
  unlocked = false
  masterPassword = 'correct horse battery staple'
  exportAuthorized = false
  records = demoRecords()
}
