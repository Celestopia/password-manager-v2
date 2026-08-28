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

`WindowsClipboard` writes copied passwords without returning them to the
renderer. It clears after 30 seconds only if the clipboard still contains the
application-managed value. `resources.py` resolves the built frontend from the
repository in source runs and PyInstaller's `_MEIPASS` in packaged runs.

### 3.4 Frontend

The React renderer is not authoritative. `frontend/src/api/client.ts` waits for
the pywebview bridge in production and uses the in-memory mock only in Vite
development mode. Persistent changes are returned by Python and followed by a
refresh when required.

Production assets use relative URLs and a Content Security Policy with
`connect-src 'none'`. Stored website values are text, not navigation targets.
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
| `password` | string | Non-empty for GUI and CLI additions. |
| `phonenumber` | string | Optional free text. |
| `mail` | string | Optional free text. |
| `date` | string | Optional free text. |
| `url` | string | Optional text; the UI does not navigate to it. |
| `custom_fields` | array | Unique non-empty string keys with string values. |
| `tags` | string array | Ordered labels. |
| `created_at` | string | UTC ISO-8601 timestamp for generated records. |
| `updated_at` | string | UTC ISO-8601 timestamp refreshed on updates. |

Unknown or missing fields, invalid scalar types, duplicate custom-field keys,
and duplicate record IDs are rejected. Search is a case-insensitive substring
match on `account` that preserves source order.

JSONL import expects one complete record per non-empty line. Merge concatenates
existing and imported records, then validates the entire collection. Replace
validates the import and replaces all records atomically. CSV and JSONL exports
are plaintext and include passwords and custom-field values. JSONL uses
deterministic key ordering; CSV stores tags and custom fields as JSON strings.

## 6. State and data flows

### 6.1 Create, unlock, and lock

Create validates a master password of at least 12 characters and a supported
memory cost, acquires the sibling lock, and writes an empty vault. Explicit
overwrite retains the previous encrypted file as `.pmdb.bak`.

Unlock acquires the lock before reading, authenticates and normalizes the whole
payload, then publishes the snapshot. Failure releases the lock and leaves the
session locked. Locking clears session references, clears application-managed
clipboard content, and releases the OS lock. Window closure invokes the same
cleanup. Python cannot guarantee physical memory zeroization.

### 6.2 Reads and secret access

`list_records` returns IDs, descriptive fields, tags, timestamps, and a custom
field presence flag. `get_record_details` adds creation time, password presence,
and custom-field keys with value-presence flags.

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

### 6.4 Concurrency and conflicts

An unlocked session holds a non-blocking one-byte Windows lock on
`<vault>.pmdb.lock`. Another cooperating process fails with `VaultBusyError`.
The lock file may remain after release; ownership is the OS byte-range lock, not
file existence.

SHA-256 content fingerprints additionally detect programs that ignore the lock.
A mismatch raises `VaultConflictError`; the caller must lock and reopen before
saving again.

### 6.5 Master-password rotation

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
adjacent. The build does not create an installer, ship the evergreen WebView2
runtime, sign the executable, or publish artifacts.

## 10. Verification strategy

Python tests cover authentication, schemas, encrypted writes, backups,
conflicts, fixed-format compatibility, malicious KDF bounds, locking, KDF cost
retention, salt/nonce rotation, rollback, minimal bridge exposure, and one-shot
path grants. Frontend tests cover locked state, unlock, password masking, reveal,
and password confirmation.

`scripts/verify.ps1` also runs Ruff, strict Mypy, TypeScript compilation, ESLint,
Vitest, a Vite production build, and a source Edge-backend smoke test. The build
script packages the application and runs the packaged resource/backend smoke
test.

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
- **Native clipboard:** Copies avoid JavaScript but remain temporarily visible to
  other local processes.
- **No automatic lock:** This product decision increases the importance of
  explicit lock and close cleanup.
- **Encrypted backups:** Recoverability is favored over invalidating the prior
  state; password rotation does not revoke old backups.
- **Windows-only implementation:** `msvcrt`, Win32 clipboard APIs, and WebView2
  are intentional platform dependencies.

Review [SECURITY.md](SECURITY.md) before modifying bridge exposure, secret
lifecycle, cryptographic parameters, import/export behavior, or platform scope.
