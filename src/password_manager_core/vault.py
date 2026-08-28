"""High-level encrypted vault file operations and transactional writes."""

from __future__ import annotations

import hashlib
import os
import shutil
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path

from .crypto import KdfParams, KdfProfile, decrypt_payload, encrypt_payload, split_vault
from .exceptions import VaultConflictError, VaultFormatError
from .models import Record, jsonl_to_records, records_to_jsonl

MAX_VAULT_SIZE = 64 * 1024 * 1024
MAX_IMPORT_SIZE = 64 * 1024 * 1024


@dataclass(frozen=True)
class FileFingerprint:
    """Content-based identity used for optimistic external-change detection."""

    size: int
    sha256: str


@dataclass(frozen=True)
class VaultSnapshot:
    """An authenticated in-memory snapshot and its persistence metadata."""

    records: list[Record]
    kdf_profile: KdfProfile
    fingerprint: FileFingerprint


def fingerprint_bytes(data: bytes) -> FileFingerprint:
    """Return a stable fingerprint for exact file bytes."""

    return FileFingerprint(size=len(data), sha256=hashlib.sha256(data).hexdigest())


def fingerprint_file(path: Path) -> FileFingerprint:
    """Read a bounded vault file and calculate its fingerprint."""

    return fingerprint_bytes(read_bounded(path, MAX_VAULT_SIZE, "Vault file"))


def read_bounded(path: Path, maximum: int, label: str) -> bytes:
    """Read a file only when its declared and actual size are bounded."""

    size = path.stat().st_size
    if size > maximum:
        raise VaultFormatError(f"{label} exceeds the supported size limit.")
    data = path.read_bytes()
    if len(data) > maximum:
        raise VaultFormatError(f"{label} exceeds the supported size limit.")
    return data


def load_vault(path: Path, master_password: str) -> VaultSnapshot:
    """Read, authenticate, decrypt, and validate a complete vault."""

    vault_bytes = read_bounded(path, MAX_VAULT_SIZE, "Vault file")
    header, _, _ = split_vault(vault_bytes)
    params = KdfParams.from_json(header["kdf"])
    records = jsonl_to_records(decrypt_payload(vault_bytes, master_password))
    return VaultSnapshot(records=records, kdf_profile=params.profile, fingerprint=fingerprint_bytes(vault_bytes))


def read_records(path: Path, master_password: str) -> list[Record]:
    """Compatibility helper returning only decrypted records."""

    return load_vault(path, master_password).records


def write_records(
    path: Path,
    records: list[Record],
    master_password: str,
    *,
    kdf_profile: KdfProfile | None = None,
    expected_fingerprint: FileFingerprint | None = None,
    make_backup: bool = True,
) -> FileFingerprint:
    """Validate, encrypt, and atomically persist a whole vault.

    When ``expected_fingerprint`` is supplied, an external modification is
    rejected immediately before the replacement transaction begins.
    """

    if expected_fingerprint is not None:
        actual = fingerprint_file(path)
        if actual != expected_fingerprint:
            raise VaultConflictError("Vault changed on disk. Reload it before saving.")
    encrypted = encrypt_payload(records_to_jsonl(records), master_password, kdf_profile=kdf_profile)
    if len(encrypted) > MAX_VAULT_SIZE:
        raise VaultFormatError("Encrypted vault exceeds the supported size limit.")
    atomic_write(path, encrypted, make_backup=make_backup)
    return fingerprint_bytes(encrypted)


def initialize_vault(
    path: Path,
    master_password: str,
    *,
    overwrite: bool = False,
    kdf_profile: KdfProfile | None = None,
) -> FileFingerprint:
    """Create an empty vault, retaining a backup when overwriting."""

    exists = path.exists()
    if exists and not overwrite:
        raise FileExistsError(f"Vault already exists: {path}")
    return write_records(
        path,
        [],
        master_password,
        kdf_profile=kdf_profile,
        make_backup=exists and overwrite,
    )


def read_header(path: Path) -> dict[str, object]:
    """Read bounded unauthenticated header metadata without decrypting records."""

    header, _, _ = split_vault(read_bounded(path, MAX_VAULT_SIZE, "Vault file"))
    return header


def read_import_jsonl(path: Path) -> list[Record]:
    """Read a bounded plaintext JSONL import."""

    return jsonl_to_records(read_bounded(path, MAX_IMPORT_SIZE, "Import file"))


def atomic_write(path: Path, data: bytes, *, make_backup: bool) -> None:
    """Write through a same-directory temporary file and atomic replacement."""

    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    backup_path = path.with_suffix(path.suffix + ".bak")
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("wb", delete=False, dir=path.parent, prefix=f".{path.name}.") as tmp:
            tmp_path = Path(tmp.name)
            tmp.write(data)
            tmp.flush()
            os.fsync(tmp.fileno())
        try:
            os.chmod(tmp_path, stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
        if make_backup and path.exists():
            shutil.copy2(path, backup_path)
        os.replace(tmp_path, path)
        tmp_path = None
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)

