# Security model and known risks

This document defines the security boundary and residual risks. See
[PROJECT.md](PROJECT.md) for the complete architecture, data contracts, and
operation flows.

## Implemented controls

- The application is offline and starts no listening network service.
- Production rendering uses a bundled local page with pywebview debug mode off.
- The bridge exposes business methods only; there is no arbitrary file, shell,
  Python evaluation, or generic URL-opening method.
- File operations require a one-shot native-dialog path grant for their exact
  purpose. Plaintext export also requires explicit confirmation and fresh
  master-password reauthentication. A mismatch immediately locks the vault and
  leaves clipboard content unchanged.
- JSONL import is merge-only. Identical existing IDs are skipped, different
  content under an existing ID aborts the entire transaction, and no import path
  can replace all current records.
- Passwords and custom-field values are omitted from list/detail responses.
  Reveal is explicit, password display auto-hides after 10 seconds, and native
  password copies bypass renderer memory.
- Vault writes use Argon2id, ChaCha20-Poly1305, fresh salts/nonces, bounds checked
  before key derivation, encrypted backups, atomic replacement, strict locking,
  and external-change detection.

## Residual risks and deliberate choices

- An unlocked vault and master password exist in Python process memory. Python
  cannot guarantee reliable zeroization, so malware or a privileged memory dump
  can recover secrets. This is inherent in the chosen desktop architecture.
- Automatic locking is deliberately disabled per product requirements. Users
  must press **Lock vault** or close the application when leaving the machine.
- Explicit reveal places one secret in renderer memory for up to 10 seconds.
  Custom-field values remain until hidden, another record is selected, editing
  starts, or the vault locks. Copy avoids renderer exposure, but the Windows
  clipboard remains visible to other local processes until the user or another
  application replaces it. Locking and shutdown do not clear it.
- Plaintext JSONL/CSV import and export files are outside vault protection. The
  app warns before using them; exports additionally require master-password
  reauthentication and grant one operation for at most five minutes. Deletion
  and secure erasure remain the user's responsibility and cannot be guaranteed
  on modern storage.
- The `.bak` file is encrypted with the previous state and, after master-password
  rotation, the previous password. Keeping it improves recoverability but means
  password rotation does not invalidate already retained encrypted backups.
- Edge WebView2 must be installed and patched by Windows. The build ships the
  application, not the evergreen WebView2 runtime.
- The application is Windows-only. File locking and clipboard behavior are not
  portable and must be redesigned before adding another operating system.

## Reporting

Do not attach real vaults, exports, passwords, or backup files to bug reports.
Use a newly generated test vault with synthetic credentials.
