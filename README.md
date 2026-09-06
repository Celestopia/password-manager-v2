# Password Manager v2

Password Manager v2 is a Windows-only, offline password vault with a
React/TypeScript interface, an Edge WebView2 desktop window, and a Python
encryption core. It stores credentials in local `.pmdb` files protected by
Argon2id and ChaCha20-Poly1305.

## What it provides

- Create, open, search, sort, edit, and delete password records.
- Store tags and encrypted custom fields.
- Sort entries by account name, vault order, creation time, or update time.
- Drag an entry's grip handle to change the saved default order.
- Reveal passwords explicitly or copy them through the native clipboard.
- Clear copied passwords after 30 seconds when the clipboard is unchanged.
- Hide a revealed password again after 10 seconds.
- Import complete records from JSONL and explicitly export plaintext JSONL/CSV.
- Rotate the master password and retain encrypted recovery backups.
- Detect competing writers and external file changes before saving.

The application is local-only: production starts no web server and provides no
cloud synchronization or account recovery. Automatic locking is not enabled;
lock the vault or close the application before leaving the computer.

## Requirements

- Windows 10 or Windows 11 with the evergreen Edge WebView2 runtime.
- Conda for the project-local Python 3.12 environment.
- Node.js 24 and npm 11 for frontend development and builds.

Project dependencies are installed under `.conda` and
`frontend/node_modules`; they do not need to be installed globally.

## Set up the repository

From PowerShell in the repository root, run:

```powershell
.\scripts\bootstrap.ps1
```

This creates or updates the local Conda environment from `environment.yml` and
`requirements-lock.txt`, then installs locked frontend packages with `npm ci`.

## Run the desktop application

Build the frontend and start the source application:

```powershell
Set-Location frontend
npm run build
Set-Location ..
.\.conda\python.exe -m password_manager_desktop
```

The GUI uses native file dialogs for vault, import, and export paths. A new
master password must contain at least 12 characters. The default Argon2id memory
setting is 64 MiB.

Reordering is available only with `default` sorting, the upward direction arrow,
and an empty search box. Drag the small grip beside an entry and drop at the
insertion line; the list scrolls automatically near its edges. Keyboard users
can focus the grip, press Space to pick up, use Up/Down (or Home/End) to move,
and press Space or Enter to save. Escape cancels. Each move saves immediately
without changing entry timestamps; there is no Undo action.

JSONL and CSV exports contain plaintext secrets. Choosing either export format
opens a password panel before the save dialog. Re-enter the current master
password to authorize one export; one incorrect attempt immediately locks the
vault and clears application-managed clipboard content.

For frontend-only development with synthetic in-memory data:

```powershell
Set-Location frontend
npm run dev
```

The Vite mock is development-only. Production requires the pywebview bridge and
never falls back to mock vault data.

## Use the CLI

The CLI shares the desktop application's validation, locking, and transactional
save behavior:

```powershell
.\.conda\python.exe -m password_manager_cli --help
.\.conda\python.exe -m password_manager_cli init .\vault.pmdb
.\.conda\python.exe -m password_manager_cli list .\vault.pmdb
```

Secrets and master passwords are read through hidden prompts. Plaintext export
is refused unless `--confirm-plaintext` is supplied.

## Prepare JSONL imports

JSONL imports are UTF-8 files with one complete record per line. Every record
must include all fixed-schema fields, including a unique ID and timestamps:

```json
{"id":"7be1424d-5c31-4afb-85b5-53a5d8821c15","account":"Example","username":"alice","password":"synthetic-secret","phonenumber":"","mail":"alice@example.test","date":"","url":"https://example.test","description":"Primary personal account","custom_fields":[{"key":"PIN","value":"1234"}],"tags":["demo"],"created_at":"2026-08-28T00:00:00Z","updated_at":"2026-08-28T00:00:00Z"}
```

Import is merge-only and never replaces the current vault. Records with new IDs
are added, records that are completely identical to an existing ID are skipped,
and an existing ID with different content aborts the whole import. Duplicate IDs
inside the import file are invalid. Successful results report both added and
skipped counts.

`description` is a required string in every serialized record, although it may
be empty. Vaults and JSONL files created before this field was introduced must
be explicitly migrated; the application does not silently repair old schemas.

Use only synthetic values in fixtures and examples. Imports and exports are
plaintext; remove them safely when they are no longer needed.

## Verify and build

Run every Python and frontend check:

```powershell
.\scripts\verify.ps1
```

Create and smoke-test the Windows onedir distribution:

```powershell
.\scripts\build.ps1
```

The output is `release\PasswordManagerV2\PasswordManagerV2.exe`. Keep the
entire `PasswordManagerV2` directory together because the executable depends on
its adjacent `_internal` directory. The build is not code-signed and does not
include an installer or the evergreen WebView2 runtime.

The executable and desktop window use `assets\pm-icon.ico`. The editable vector
source is retained at `assets\pm-icon.svg`.
After rebuilding the same output path, the build script asks Windows Shell to
refresh that executable's cached icon. An already-open Explorer window may still
need a normal **Refresh** action to repaint immediately.

Vaults (`*.pmdb`), encrypted backups (`*.pmdb.bak`), lock files, plaintext
imports/exports, dependency directories, and build outputs are ignored by Git.

## Developer documentation

- [PROJECT.md](PROJECT.md) describes architecture, contracts, data flow,
  configuration, implementation decisions, verification, and trade-offs.
- [SECURITY.md](SECURITY.md) documents the threat model, implemented controls,
  and residual risks.
