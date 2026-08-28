export interface VaultStatus { unlocked: boolean; vault_path: string | null; record_count: number }
export interface RecordSummary { id: string; account: string; username: string; phonenumber: string; mail: string; date: string; url: string; tags: string[]; updated_at: string; has_custom_fields: boolean }
export interface CustomField { key: string; value: string }
export interface HiddenCustomField { key: string; has_value: boolean }
export interface RecordDetails extends RecordSummary { created_at: string; has_password: boolean; custom_fields: HiddenCustomField[] }
export interface RecordInput { account: string; username: string; phonenumber: string; mail: string; date: string; url: string; tags: string[]; custom_fields: CustomField[]; password?: string; password_change?: string }
export interface ImportResult { imported_count: number; skipped_count: number }
export interface ApiFailure { ok: false; error: { code: string; message: string } }
export interface ApiSuccess<T> { ok: true; data: T }
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

export interface NativeApi {
  get_status(): Promise<ApiResponse<VaultStatus>>
  choose_vault(): Promise<ApiResponse<{ path: string | null }>>
  choose_new_vault_path(): Promise<ApiResponse<{ path: string | null }>>
  choose_import_file(): Promise<ApiResponse<{ path: string | null }>>
  choose_export_file(format: string): Promise<ApiResponse<{ path: string | null }>>
  authorize_export(masterPassword: string): Promise<ApiResponse<{ authorized: boolean }>>
  unlock_vault(path: string, password: string): Promise<ApiResponse<VaultStatus>>
  create_vault(path: string, password: string, overwrite: boolean, memoryMiB: number): Promise<ApiResponse<VaultStatus>>
  lock_vault(): Promise<ApiResponse<VaultStatus>>
  list_records(query: string): Promise<ApiResponse<RecordSummary[]>>
  get_record_details(recordId: string): Promise<ApiResponse<RecordDetails>>
  reveal_password(recordId: string): Promise<ApiResponse<{ password: string }>>
  copy_password(recordId: string): Promise<ApiResponse<{ clear_after_seconds: number }>>
  reveal_custom_fields(recordId: string): Promise<ApiResponse<CustomField[]>>
  add_record(values: RecordInput): Promise<ApiResponse<RecordSummary>>
  update_record(recordId: string, values: Partial<RecordInput>): Promise<ApiResponse<RecordSummary>>
  delete_record(recordId: string): Promise<ApiResponse<RecordSummary>>
  import_jsonl(path: string): Promise<ApiResponse<ImportResult>>
  export_records(path: string, format: string, confirmedPlaintext: boolean): Promise<ApiResponse<{ path: string; format: string }>>
  change_master_password(currentPassword: string, newPassword: string): Promise<ApiResponse<{ changed: boolean }>>
  get_header_info(): Promise<ApiResponse<Record<string, unknown>>>
}

declare global { interface Window { pywebview?: { api: NativeApi } } }
