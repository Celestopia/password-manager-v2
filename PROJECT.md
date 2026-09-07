# Password Manager v2 technical reference

This is the authoritative technical reference for developers and automation
agents. [README.md](README.md) is the concise user guide; the threat model and
residual risks are maintained in [SECURITY.md](SECURITY.md).

## 1. Purpose and scope

Password Manager v2 is a local-only password vault for Windows. React and
TypeScript render the interface inside an Edge WebView2 window managed by
pywebview. Python owns decrypted state, cryptography, persistence, native file
dialogs, file locking, and clipboard access.

The supported scope is deliberately narrow:

- Run on Windows with the Edge WebView2 runtime.
- Store vaults in local `.pmdb` files without a cloud account or network API.
- Start no HTTP listener in production; load bundled assets through `file://`.
- Support one exclusively owned, unlocked vault per process.
- Require explicit user locking or application exit; do not lock on inactivity.
- Treat the fixed record schema and encrypted container as stable contracts.

Cloud synchronization, browser extensions, shared vaults, mobile platforms,
remote recovery, and non-Windows clipboard or locking implementations are out of
scope.

## 2. Repository layout

```text
password_manager_v2/
|-- frontend/                     React/TypeScript renderer
|   |-- src/api/                  Bridge client and development mock
|   |-- src/components/           Shared presentation components
|   `-- src/features/vault/       Vault and record dialogs
|-- packaging/                    PyInstaller entry point and onedir spec
|-- assets/                       SVG source artwork and Windows ICO resource
|-- scripts/                      Bootstrap, verification, and build commands
|-- src/
|   |-- password_manager_core/    Crypto, schema, locking, and persistence
|   |-- password_manager_desktop/ Session, bridge, clipboard, and GUI entry
|   `-- password_manager_cli/     CLI adapter over the shared session
|-- tests/                        Python boundary and behavior tests
|-- environment.yml               Local Conda environment definition
|-- requirements-lock.txt         Locked Python dependency graph
|-- pyproject.toml                Python package and tool configuration
|-- README.md                     User and contributor quick start
|-- SECURITY.md                   Threat model and residual risks
`-- PROJECT.md                    This technical reference
```

Generated and sensitive paths are excluded from Git, including `.conda/`,
`frontend/node_modules/`, `frontend/dist/`, `build/`, `release/`, vaults, lock
files, backups, and plaintext JSONL or CSV files.

## 3. Runtime architecture

### 3.1 Core package

`password_manager_core` is independent of React and pywebview. It owns the
authenticated container, Argon2id validation, fixed record schema, JSONL/CSV
serialization, bounded reads, content fingerprints, atomic replacement,
encrypted backups, and non-blocking Windows byte-range locks.

Core functions accept strict input forms and raise application-specific
exceptions instead of returning partially normalized data.

### 3.2 Authoritative session

`password_manager_desktop.session.VaultSession` is the stateful business
service. While unlocked, it owns the path, master password, normalized records,
KDF cost profile, authenticated file fingerprint, and lock handle. An `RLock`
serializes calls that may arrive concurrently from pywebview.

The session exposes non-secret summaries for ordinary reads. Passwords and
custom-field values require dedicated reveal operations. Mutations are staged
on a deep copy and published to memory only after the encrypted disk transaction
succeeds.

### 3.3 Desktop bridge and native adapters

`DesktopBridge` is the renderer trust boundary. It exposes a finite set of
business operations through `window.pywebview.api`, never arbitrary filesystem
access, command execution, Python evaluation, generic navigation, or a
general-purpose RPC method.

Native file dialogs create one-shot grants keyed by resolved path and purpose.
Import, export, unlock, and create operations must consume a matching grant;
typing an arbitrary path in JavaScript is rejected.

Plaintext export additionally requires a fresh master-password check enforced
by `VaultSession`. Success creates a bridge-local, single-use authorization that
expires after five minutes. Cancellation, timeout, explicit locking, shutdown,
or one export revokes it. One password mismatch immediately locks the session
without modifying clipboard content.

`WindowsClipboard` writes copied passwords without returning them to the
renderer. Copied passwords remain in the Windows clipboard until the user or
another application replaces them; locking and shutdown do not modify clipboard
content. `resources.py` resolves the built frontend from the
repository in source runs and PyInstaller's `_MEIPASS` in packaged runs. It also
resolves the application ICO so source windows and packaged windows use the same
visual identity.

### 3.4 Frontend

UI copy calls a complete stored item an account or account entry. Password refers
only to its credential, and master password refers to vault protection. Dialogs,
notifications, empty states, and import messages follow this distinction; native
exports default to `accounts.jsonl` or `accounts.csv`. The Password Manager v2
brand, internal record APIs, and serialized field names remain unchanged.

The React renderer is not authoritative. `frontend/src/api/client.ts` waits for
the pywebview bridge in production and uses the in-memory mock only in Vite
development mode. Persistent changes are returned by Python and followed by a
refresh when required.

Production assets use relative URLs and a Content Security Policy with
`connect-src 'none'`. Stored website values are text, not navigation targets.
Global success and error banners share a five-second dismissal lifecycle and
remain manually dismissible; inline form validation persists until corrected or
the dialog closes.
The account list supports stable sorting by vault order, account name,
system-generated creation time (`entry_created`), or update time
(`entry_updated`). Creation-time sorting uses `created_at`, never the
human-entered `date` field. The detail metadata card displays creation time on
the left and update time on the right.
`tagRegistry.ts` derives an alphabetized `{ name, accountCount }` registry from
the non-secret record summaries already held by React. It is recomputed after
every authoritative record refresh or mutation and is never serialized as a
second source of truth. Multiple selected filters use AND semantics and combine
with account-name search. The tag-filter popover is absolutely positioned over
the sidebar with its own bounded scroll area; opening it never participates in
the records pane's flex sizing or reduces the account list height.
`TagPicker.tsx` replaces comma-separated tag entry with a searchable
multi-selector. It offers registry labels, permits creation only by attaching a
new label to the record being saved, trims labels, and removes exact duplicate
inputs while preserving order. Its full horizontal control is the accessible
dropdown trigger; chip removal buttons remain independent controls.
Consequently, unused labels do not persist.
`RecordList.tsx` owns the dedicated reorder handles, pointer capture and six-pixel
activation threshold, insertion-line preview, edge scrolling, keyboard movement,
and live announcements. Edge scrolling ramps linearly within 60 CSS pixels of
the top/bottom (capped at one quarter of the list height), up to 3,600 CSS pixels
per second. Animation-frame timestamps make the rate independent of refresh
rate; elapsed time is capped at 50 ms per frame to avoid jumps after stalls and
reset for each drag. Reordering is enabled only for unfiltered, ascending
vault order. Other sort modes, a non-empty search (including whitespace), active
tag filters, open dialogs, and pending operations disable the handles with
explanatory help.
Active dragging disables competing UI actions; a save-in-progress guard prevents
duplicate submissions. Escape, focus/window loss, pointer cancellation, or an
invalid drop discards the preview. Keyboard users pick up with Space/Enter,
choose a position with Up/Down or Home/End, and confirm with Space/Enter.
pywebview runs with debug mode disabled and the Edge Chromium backend selected.
At desktop window sizes, the detail pane is constrained to the available
viewport: its card grid uses fixed tracks, and overflowing record or custom-field
content scrolls inside the owning card rather than expanding the whole pane.
Vite development mode permits inline styles because its hot-reload client injects
CSS through a `<style>` element; production output keeps the stricter external-
style policy.

### 3.5 CLI

`password_manager_cli` provides initialization, list, search, show, add, edit,
delete, import, export, password rotation, header inspection, and digest helper
commands. Vault commands reuse `VaultSession`, so CLI writes have the same
validation, locking, conflict, backup, and transaction behavior as GUI writes.

## 4. Encrypted vault contract

### 4.1 Container

The byte layout is:

```text
PMGRVAULT | uint32-be header length | UTF-8 JSON header | AEAD ciphertext
```

The magic bytes, length prefix, and exact header bytes are authenticated as
ChaCha20-Poly1305 associated data. The encrypted plaintext is UTF-8 JSON Lines
containing normalized records. The header has exactly four fields:

```json
{
  "version": 1,
  "format": "jsonl",
  "kdf": {
    "name": "argon2id",
    "salt": "unpadded-url-safe-base64",
    "time_cost": 3,
    "memory_cost": 65536,
    "parallelism": 1,
    "hash_len": 32
  },
  "cipher": {
    "name": "chacha20-poly1305",
    "nonce": "unpadded-url-safe-base64"
  }
}
```

Missing and additional fields are rejected. The derived key is 32 bytes, the
generated salt is 16 bytes, and the nonce is 12 bytes. Rewrites retain the
authenticated KDF cost profile while generating a fresh salt and nonce.

### 4.2 Untrusted-input bounds

The header is unauthenticated until derivation and AEAD verification complete,
so resource bounds are checked before Argon2id runs:

| Input | Supported bound |
|---|---:|
| Header | 65,536 bytes |
| Vault file | 64 MiB |
| JSONL import | 64 MiB |
| Argon2id memory | 8,192–1,048,576 KiB |
| Argon2id time cost | 1–20 |
| Argon2id parallelism | 1–16 |

Authentication failure raises `VaultAuthenticationError`. Structural and
resource-limit violations raise `VaultFormatError` without excessive derivation.

## 5. Record and plaintext contracts

Every record contains exactly these fields:

| Field | Type | Rule |
|---|---|---|
| `id` | string | Non-empty stable UUID generated for new records. |
| `account` | string | Non-empty display and search name. |
| `username` | string | Optional. |
| `password` | string | May be empty, including GUI and CLI additions. Blank GUI password edits keep the current value; master-password requirements are unchanged. |
| `phonenumber` | string | Optional free text. |
| `mail` | string | Optional free text. |
| `date` | string | Optional free text. |
| `url` | string | Optional text; the UI does not navigate to it. |
| `description` | string | Required free-form text that may be empty; line breaks are preserved. |
| `custom_fields` | array | Unique non-empty string keys with string values. |
| `tags` | string array | Ordered labels; GUI/session inputs are trimmed and exact duplicates are removed. |
| `created_at` | string | UTC ISO-8601 timestamp for generated records. |
| `updated_at` | string | UTC ISO-8601 timestamp refreshed on updates. |

Unknown or missing fields (including `description`), invalid scalar types, duplicate custom-field keys,
and duplicate record IDs are rejected. Search is a case-insensitive substring
match on `account` that preserves source order.

JSONL import expects one complete record per non-empty line and supports merge
only. Duplicate IDs inside the import are invalid. An imported record whose ID
and normalized content match an existing record is skipped; the same ID with
different content aborts the entire import as a conflict. Only new IDs are
added, and an all-identical import does not rewrite the vault. CSV and JSONL
exports are plaintext and include passwords and custom-field values. JSONL uses
deterministic key ordering; CSV stores tags and custom fields as JSON strings.
The description schema revision has no implicit compatibility path: old vaults
and imports missing the field are rejected and require an explicit one-time
migration.

## 6. State and data flows

### 6.1 Create, unlock, and lock

Create validates a master password of at least 12 characters and a supported
memory cost, acquires the sibling lock, and writes an empty vault. Explicit
overwrite retains the previous encrypted file as `.pmdb.bak`.

Unlock acquires the lock before reading, authenticates and normalizes the whole
payload, then publishes the snapshot. Failure releases the lock and leaves the
session locked. Locking clears session references and releases the OS lock.
Window closure invokes the same cleanup without modifying clipboard content.
Python cannot guarantee physical memory zeroization.

### 6.2 Reads and secret access

`list_records` returns IDs, compact list fields, tags, creation and update
timestamps, and a custom-field presence flag; it omits descriptions and search
continues to match only `account`. `get_record_details` adds the description,
password presence, and custom-field keys with value-presence flags.

Password and custom-field values cross the bridge only after dedicated reveal
actions. React removes a revealed password after 10 seconds. Selecting another
record, editing, hiding, or locking clears revealed state. `copy_password`
bypasses JavaScript and uses the native clipboard adapter.

### 6.3 Transactional mutation

Add, update, delete, and import follow one sequence:

1. Validate the operation payload against its exact allowlist.
2. Compare disk content with the authenticated session fingerprint.
3. Deep-copy records and apply the requested mutation.
4. Normalize and validate the complete staged collection.
5. Recheck the expected fingerprint immediately before persistence.
6. Encrypt into a same-directory temporary file and flush it.
7. Copy the prior encrypted vault to `.pmdb.bak`.
8. Atomically replace the vault with `os.replace`.
9. Publish staged records and the new fingerprint to the session.

Failure before step 9 leaves memory unchanged. Temporary files are removed in a
`finally` path. The backup represents the last persisted encrypted state.

### 6.3.1 Persistent record reordering

`move_record(record_id, target_id, placement)` accepts only record IDs and
`before`/`after` placement. It validates both records under the session lock
and reorders a staged list through the existing transactional mutation path.
Self-moves and already-adjacent placements that preserve order do not rewrite
the vault or its backup. External-change checks still apply.

Successful responses contain `{ changed: boolean, records: RecordSummary[] }`,
an authoritative non-secret snapshot returned under the same session lock.
The frontend replaces its summary list from this response while retaining the
selected ID and detail view. Until success, only an insertion indicator changes;
on failure the confirmed list remains unchanged and the normal error banner
explains the failure. Each confirmed move saves once; there is no Undo action.

Reordering modifies the encrypted JSONL sequence, not record fields or a
separate position property. IDs, creation/update timestamps, and all other
content remain unchanged. Default listing and exports follow the stored order
after reopening; new records and new import additions still append at the end.
No schema migration is required.

### 6.3.2 Derived tag registry and bulk mutation

The registry is the union of non-empty, trimmed tag labels in record summaries;
it is not application-level data and adds no field to the encrypted payload.
Each registry count includes an account at most once even if imported legacy
data repeats a label. Import, add, edit, delete, rename, and tag removal all
cause the frontend registry to be recomputed. Removing the last reference also
removes the label from the registry.

`rename_tag(old_name, new_name)` replaces the exact old label in all affected
records. If the new label already exists on an affected record, the operation
merges the labels without leaving a duplicate. `delete_tag(name)` removes the
exact label from all affected records. Both operations trim and validate their
arguments, preserve record order, update `updated_at` only on affected records,
stage the complete change through `_mutate`, and write the vault at most once.
No-op requests do not rewrite the vault or backup. Their safe bridge result is
`{ changed: boolean, records: RecordSummary[] }`; secret values never cross the
boundary. The manager asks for confirmation before a merge or vault-wide
removal.

### 6.4 Plaintext export reauthentication

Selecting JSONL or CSV opens a modal that warns that all secrets will be written
in plaintext and asks for the master password. The backend compares it in
constant time with the authenticated session password. Failure immediately
locks the vault; success permits only the following native save-dialog and one
matching export. The password is not retained as an export credential in the
renderer, and the authorization is revoked on cancellation or after five
minutes.

### 6.5 Concurrency and conflicts

An unlocked session holds a non-blocking one-byte Windows lock on
`<vault>.pmdb.lock`. Another cooperating process fails with `VaultBusyError`.
The lock file may remain after release; ownership is the OS byte-range lock, not
file existence.

SHA-256 content fingerprints additionally detect programs that ignore the lock.
A mismatch raises `VaultConflictError`; the caller must lock and reopen before
saving again.

### 6.6 Master-password rotation

Rotation compares the current in-memory password in constant time, verifies the
fingerprint, reauthenticates from disk, and rewrites with the new password. It
preserves KDF costs and rotates salt and nonce. The session adopts the new
password only after success. The new `.bak` remains encrypted under the prior
master password.

## 7. Bridge output contracts

Every public bridge call returns:

```ts
type Success<T> = { ok: true; data: T }
type Failure = { ok: false; error: { code: string; message: string } }
```

Stable failure codes are:

| Code | Meaning |
|---|---|
| `VAULT_AUTHENTICATION_FAILED` | Password mismatch or failed authentication. |
| `VAULT_BUSY` | Another process owns the vault lock. |
| `VAULT_CONFLICT` | Vault bytes changed after unlock. |
| `VAULT_FORMAT_INVALID` | Container or KDF parameters are invalid. |
| `RECORD_INVALID` | Record input violates the schema. |
| `RECORD_NOT_FOUND` | Selected record is absent. |
| `IMPORT_CONFLICT` | An imported ID exists with different record content. |
| `SESSION_STATE_INVALID` | Operation conflicts with current lock state. |
| `PLAINTEXT_CONFIRMATION_REQUIRED` | Export lacks acknowledgement. |
| `FILE_NOT_FOUND` / `FILE_EXISTS` | Filesystem precondition failed. |
| `PERMISSION_DENIED` | Path lacks a matching dialog grant. |
| `INVALID_ARGUMENT` | Bridge input has an invalid strict type or value. |
| `IO_ERROR` | Expected operating-system I/O failure. |
| `INTERNAL_ERROR` | Unexpected exception hidden at the boundary. |

Unexpected exceptions never send tracebacks to the renderer. Frontend
`BridgeError` preserves the stable code and displays the safe message.

## 8. Configuration and dependencies

There is no external runtime configuration file, service endpoint, or
environment-based secret. KDF memory is selected only during vault creation;
the default is 64 MiB and the authenticated profile is reused on every rewrite.

Python 3.12 is pinned in `environment.yml`; exact Python packages are locked in
`requirements-lock.txt` and installed into `.conda`. Frontend engines and
packages are declared in `frontend/package.json`, locked in `package-lock.json`,
and installed into `frontend/node_modules`.

Use `scripts/bootstrap.ps1` for both dependency trees. Do not globally install
project packages. [LESSONS.md](LESSONS.md) records this repository rule.

## 9. Commands and material outputs

| Command | Purpose | Output |
|---|---|---|
| `scripts/bootstrap.ps1` | Create/update local dependencies. | `.conda/`, `frontend/node_modules/`. |
| `scripts/verify.ps1` | Run Python and frontend checks. | `frontend/dist/`. |
| `python -m password_manager_desktop` | Run the source GUI. | User-selected vault and support files. |
| `python -m password_manager_cli` | Run CLI operations. | Command-specific vault or plaintext files. |
| `scripts/build.ps1` | Verify, package, and smoke-test. | `release/PasswordManagerV2/`. |

The packaged executable is
`release/PasswordManagerV2/PasswordManagerV2.exe`. Its `_internal` directory
contains Python, WebView2 loader assemblies, and frontend assets and must remain
adjacent. PyInstaller embeds `assets/pm-icon.ico` into the executable and bundles
the same file for the pywebview window icon. The build does not create an
installer, ship the evergreen WebView2 runtime, sign the executable, or publish
artifacts.

## 10. Verification strategy

Python tests cover authentication, schemas, encrypted writes, backups,
conflicts, fixed-format compatibility, malicious KDF bounds, locking, KDF cost
retention, salt/nonce rotation, rollback, minimal bridge exposure, one-shot path
grants, merge-only imports, and export reauthentication. Frontend tests cover
locked state, unlock, password masking, reveal, password confirmation, guarded
import/export, five-second global messages, and lockout after one failed export
password attempt.

`scripts/verify.ps1` also runs Ruff, strict Mypy, TypeScript compilation, ESLint,
Vitest, a Vite production build, and a source Edge-backend smoke test. The build
script packages the application and runs the packaged resource/backend smoke
test in a hidden process, waits for its real exit code, and leaves no background
application instance holding packaged files open. After a successful build, it
sends path-scoped item and directory update notifications to Windows Shell so
Explorer re-reads the replaced executable's embedded icon without clearing the
user's global icon cache or restarting Explorer.

Keep contracts and documentation synchronized:

- Container or schema changes require golden or serialization tests.
- Bridge changes require matching Python and TypeScript contracts.
- Secret-lifecycle changes require bridge and UI tests.
- Packaging/resource changes require source and packaged smoke tests.
- User-visible behavior changes require a README update.

## 11. Design rationale and trade-offs

- **Web renderer, native authority:** React provides the GUI while Python remains
  the persistence authority and security boundary.
- **No production server:** Local assets remove listening ports and HTTP routing
  from the desktop threat surface.
- **Whole-vault transactions:** Bounded vault sizes make whole-file
  authentication and atomic replacement simpler than record-level writes.
- **Fail-fast ownership:** Exclusive locking avoids ambiguous merges;
  fingerprints still catch non-cooperating writers.
- **One-shot path grants:** Native selection constrains filesystem effects
  without a general renderer file API.
- **Native clipboard:** Copies avoid JavaScript but remain visible to other local
  processes until the user or another application replaces the clipboard.
- **No automatic lock:** This product decision increases the importance of
  explicit lock and close cleanup.
- **Encrypted backups:** Recoverability is favored over invalidating the prior
  state; password rotation does not revoke old backups.
- **Windows-only implementation:** `msvcrt`, Win32 clipboard APIs, and WebView2
  are intentional platform dependencies.

Review [SECURITY.md](SECURITY.md) before modifying bridge exposure, secret
lifecycle, cryptographic parameters, import/export behavior, or platform scope.
